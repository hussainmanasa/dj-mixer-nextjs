"use client";

// Library state: the connected music folder, every track and its analysis,
// and booth settings. Used by the admin library page and by the auto-DJ.

import { useMemo } from "react";
import { create } from "zustand";
import { analyzeFile } from "@/lib/analysis/analyze";
import { ANALYSIS_VERSION } from "@/lib/analysis/bpm";
import { ensurePermission, fileId, getFileAt, isSupported, pickFolder, trackFromFile, walk } from "@/lib/library/scan";
import {
  DEFAULT_SETTINGS,
  loadFolderHandle,
  loadSettings,
  loadTracks,
  saveFolderHandle,
  saveSettings,
  saveTracks,
  type Settings,
} from "@/lib/library/store";
import { getMood, resolveMoods } from "@/lib/dj/moods";
import { MAX_DECKS, MIN_DECKS, type Mood, type MoodId, type Track, type TrackAnalysis, type TrackCues, type TrackFlag, type TrackOverrides } from "@/lib/types";

export type FolderState = "none" | "needs-permission" | "ready";

interface LibraryState {
  hydrated: boolean;
  folder: FileSystemDirectoryHandle | null;
  folderState: FolderState;
  tracks: Record<string, Track>;
  settings: Settings;
  scanning: boolean;
  analysis: { done: number; total: number; current: string | null } | null;
  error: string | null;

  hydrate: () => Promise<void>;
  chooseFolder: () => Promise<void>;
  reconnect: () => Promise<boolean>;
  rescan: () => Promise<void>;
  analyzePending: () => Promise<void>;
  retryFailed: () => Promise<void>;
  setDeckCount: (n: number) => Promise<void>;
  setKeyLock: (on: boolean) => Promise<void>;
  /** Save an edited mood (only the fields that differ from the preset are stored); null resets it. */
  saveMood: (mood: Mood | null, id: MoodId) => Promise<void>;
  /** Fallback when folders can't be opened: add files for this session only. */
  addSessionFiles: (files: File[]) => Promise<void>;
  getFile: (track: Track) => Promise<File>;
  markError: (id: string, message: string) => void;
  setFlag: (id: string, flag: TrackFlag | undefined) => Promise<void>;
  setCrates: (id: string, crates: string[]) => Promise<void>;
  /** Save song markers; `null` clears one. */
  setCues: (id: string, cues: { [K in keyof TrackCues]?: number | null }) => Promise<void>;
  /**
   * Admin fixes. A new beat grid re-analyses the track on it (resolves when
   * done); drop sensitivity and key apply at once. `null` clears an override.
   */
  setOverrides: (id: string, overrides: { [K in keyof TrackOverrides]?: TrackOverrides[K] | null }) => Promise<void>;
}

let analysisRunning = false;

/** Files added via the file input; not persisted (the browser can't reopen them). */
const sessionFiles = new Map<string, File>();
const SESSION_PREFIX = "session:";

/** Persist only folder-backed tracks; session-file tracks vanish on reload. */
function persistTracks(tracks: Record<string, Track>): Promise<void> {
  const keep: Record<string, Track> = {};
  for (const t of Object.values(tracks)) if (!t.path.startsWith(SESSION_PREFIX)) keep[t.id] = t;
  return saveTracks(keep);
}

export const useLibrary = create<LibraryState>((set, get) => ({
  hydrated: false,
  folder: null,
  folderState: "none",
  tracks: {},
  settings: DEFAULT_SETTINGS,
  scanning: false,
  analysis: null,
  error: null,

  async hydrate() {
    if (get().hydrated) return;
    const [folder, tracks, settings] = await Promise.all([loadFolderHandle(), loadTracks(), loadSettings()]);
    let folderState: FolderState = "none";
    if (folder) folderState = (await ensurePermission(folder, false)) ? "ready" : "needs-permission";
    // Tracks interrupted mid-analysis go back to pending.
    for (const t of Object.values(tracks)) if (t.status === "pending") t.analysis = null;
    set({ hydrated: true, folder: folder ?? null, folderState, tracks, settings });
  },

  async chooseFolder() {
    try {
      const folder = await pickFolder();
      await saveFolderHandle(folder);
      set({ folder, folderState: "ready", error: null });
      await get().rescan();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  async reconnect() {
    const { folder } = get();
    if (!folder) return false;
    const ok = await ensurePermission(folder, true);
    set({ folderState: ok ? "ready" : "needs-permission" });
    if (ok) void get().analyzePending();
    return ok;
  },

  async rescan() {
    const { folder } = get();
    if (!folder || get().scanning) return;
    set({ scanning: true, error: null });
    try {
      const existing = { ...get().tracks };
      const next: Record<string, Track> = {};
      for await (const found of walk(folder)) {
        const id = await fileId(found.file);
        if (next[id]) continue; // duplicate file in the library
        const known = existing[id];
        if (known?.path.startsWith(SESSION_PREFIX)) continue;
        next[id] = known ? { ...known, path: found.path } : await trackFromFile(found, id);
      }
      for (const t of Object.values(existing)) if (t.path.startsWith(SESSION_PREFIX) && !next[t.id]) next[t.id] = t;
      await persistTracks(next);
      set({ tracks: next });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ scanning: false });
    }
    void get().analyzePending();
  },

  async analyzePending() {
    if (analysisRunning) return;
    analysisRunning = true;
    try {
      // New tracks first, then ones analysed by an older version (they stay playable meanwhile).
      const all = Object.values(get().tracks);
      const pendingIds = [...all.filter((t) => t.status === "pending"), ...all.filter(isStale)].map((t) => t.id);
      let done = 0;
      for (const id of pendingIds) {
        const track = get().tracks[id];
        if (!track) continue;
        set({ analysis: { done, total: pendingIds.length, current: track.title } });
        let updated: Track;
        try {
          updated = await analyzeTrack(track, get().getFile);
        } catch (err) {
          // A stale track keeps its old analysis; the booth will flag it if it really can't be read.
          if (isStale(track)) {
            done++;
            continue;
          }
          updated = { ...track, status: "error", error: err instanceof Error ? err.message : "Could not decode file" };
        }
        const tracks = { ...get().tracks, [id]: updated };
        set({ tracks });
        await persistTracks(tracks);
        done++;
      }
    } finally {
      analysisRunning = false;
      set({ analysis: null });
    }
  },

  async retryFailed() {
    const tracks = { ...get().tracks };
    for (const t of Object.values(tracks)) if (t.status === "error") tracks[t.id] = { ...t, status: "pending", error: undefined };
    set({ tracks });
    await persistTracks(tracks);
    await get().analyzePending();
  },

  async setDeckCount(n) {
    const deckCount = Math.max(MIN_DECKS, Math.min(MAX_DECKS, Math.round(n)));
    const settings = { ...get().settings, deckCount };
    set({ settings });
    await saveSettings(settings);
  },

  async setKeyLock(on) {
    const settings = { ...get().settings, keyLock: on };
    set({ settings });
    await saveSettings(settings);
  },

  async saveMood(mood, id) {
    const moods = { ...get().settings.moods };
    if (!mood) delete moods[id];
    else {
      const preset = getMood(id);
      const diff: Partial<Mood> = {};
      for (const k of Object.keys(mood) as (keyof Mood)[]) {
        if (k !== "id" && JSON.stringify(mood[k]) !== JSON.stringify(preset[k])) (diff as Record<string, unknown>)[k] = mood[k];
      }
      if (Object.keys(diff).length) moods[id] = diff;
      else delete moods[id];
    }
    const settings = { ...get().settings, moods };
    set({ settings });
    await saveSettings(settings);
  },

  async addSessionFiles(files) {
    const tracks = { ...get().tracks };
    for (const file of files) {
      if (!isSupported(file.name)) continue;
      const id = await fileId(file);
      if (tracks[id]) continue;
      const path = `${SESSION_PREFIX}${file.name}`;
      sessionFiles.set(path, file);
      tracks[id] = await trackFromFile({ path, file }, id);
    }
    set({ tracks });
    void get().analyzePending();
  },

  async getFile(track) {
    const sessionFile = sessionFiles.get(track.path);
    if (sessionFile) return sessionFile;
    const { folder } = get();
    if (!folder) throw new Error("No music folder connected");
    return getFileAt(folder, track.path);
  },

  async setFlag(id, flag) {
    await patchTrack(id, (t) => ({ ...t, flag }));
  },

  async setCrates(id, crates) {
    const clean = [...new Set(crates.map((c) => c.trim()).filter(Boolean))].sort();
    await patchTrack(id, (t) => ({ ...t, crates: clean.length ? clean : undefined }));
  },

  async setCues(id, changes) {
    await patchTrack(id, (t) => {
      const cues: TrackCues = { ...t.cues };
      for (const [k, v] of Object.entries(changes) as [keyof TrackCues, number | null | undefined][]) {
        if (v === null || v === undefined) delete cues[k];
        else cues[k] = Math.round(v * 1000) / 1000;
      }
      return { ...t, cues: Object.keys(cues).length ? cues : undefined };
    });
  },

  async setOverrides(id, changes) {
    const track = get().tracks[id];
    if (!track) return;
    const merged: TrackOverrides = { ...track.overrides };
    for (const [k, v] of Object.entries(changes) as [keyof TrackOverrides, number | string | null | undefined][]) {
      if (v === null || v === undefined) delete merged[k];
      else (merged as Record<string, number | string>)[k] = v;
    }
    const overrides = Object.keys(merged).length ? merged : undefined;
    const gridChanged = merged.bpm !== track.overrides?.bpm || merged.firstBeat !== track.overrides?.firstBeat;
    let next: Track = { ...track, overrides };
    if (gridChanged) next = await analyzeTrack(next, get().getFile);
    else if (next.analysis) next = withAnalysis(next, next.analysis);
    await patchTrack(id, () => next);
  },

  markError(id, message) {
    const t = get().tracks[id];
    if (!t) return;
    const tracks = { ...get().tracks, [id]: { ...t, status: "error" as const, error: message } };
    set({ tracks });
    void persistTracks(tracks);
  },
}));

/**
 * A track with a fresh analysis: admin overrides re-applied, then the key —
 * set by hand, else from the file's tag, else detected from the audio.
 */
export function withAnalysis(track: Track, analysis: TrackAnalysis): Track {
  const manual = track.overrides?.key;
  const tagged = track.keySource === "tag" || (!!track.camelot && !track.keySource) ? track.camelot : null;
  // Remember the tag key separately so a cleared manual key can fall back to it.
  const tagKey = track.tagKey ?? tagged ?? undefined;
  const camelot = manual ?? tagKey ?? analysis.detectedKey ?? null;
  return {
    ...track,
    tagKey,
    analysis: { ...analysis, fullLevel: track.overrides?.fullLevel },
    camelot,
    keySource: manual ? "manual" : tagKey ? "tag" : analysis.detectedKey ? "audio" : undefined,
    status: "ready",
    error: undefined,
  };
}

/** Analyse one track (on the admin's beat grid if set) and return it updated. */
async function analyzeTrack(track: Track, getFile: (t: Track) => Promise<File>): Promise<Track> {
  const file = await getFile(track);
  const o = track.overrides;
  const forced = o?.bpm && o.firstBeat !== undefined ? { bpm: o.bpm, firstBeat: o.firstBeat } : null;
  return withAnalysis(track, await analyzeFile(file, track.tagBpm, forced));
}

/** Update one track in state and storage. */
async function patchTrack(id: string, fn: (t: Track) => Track): Promise<void> {
  const t = useLibrary.getState().tracks[id];
  if (!t) return;
  const tracks = { ...useLibrary.getState().tracks, [id]: fn(t) };
  useLibrary.setState({ tracks });
  await persistTracks(tracks);
}

/** Playable, but analysed before the current ANALYSIS_VERSION (e.g. without bar levels). */
function isStale(t: Track): boolean {
  return t.status === "ready" && !!t.analysis && (t.analysis.version ?? 1) < ANALYSIS_VERSION;
}

/** Mood presets with the admin's edits, for the UI. */
export function useMoods(): Mood[] {
  const overrides = useLibrary((s) => s.settings.moods);
  return useMemo(() => resolveMoods(overrides), [overrides]);
}

export function readyTracks(tracks: Record<string, Track>): Track[] {
  return Object.values(tracks).filter((t) => t.status === "ready" && t.analysis);
}
