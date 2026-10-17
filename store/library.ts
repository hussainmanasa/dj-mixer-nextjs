"use client";

// Library state: the connected music folder, every track and its analysis,
// and booth settings. Used by the admin library page and by the auto-DJ.

import { useMemo } from "react";
import { create } from "zustand";
import { analyzeFile } from "@/lib/analysis/analyze";
import { GridPreview, sharedPreview } from "@/lib/library/preview";
import { analysesFor, applySettingsFile, buildSettingsFile, contentKey, parseSettingsFile, SETTINGS_FILE, type SettingsFile } from "@/lib/library/settingsFile";
import { canWrite, readSettingsFile, requestWrite, writeSettingsFile } from "@/lib/library/settingsFolder";
import { ANALYSIS_VERSION } from "@/lib/analysis/bpm";
import { ensurePermission, fileId, getFileAt, isSupported, pickFolder, trackFromFile, walk } from "@/lib/library/scan";
import {
  DEFAULT_SETTINGS,
  loadFolderHandle,
  loadSessionTracks,
  loadSettings,
  loadTracks,
  saveFolderHandle,
  saveSessionTracks,
  saveSettings,
  saveSettingsSync,
  loadSettingsSync,
  saveTracks,
  type Settings,
} from "@/lib/library/store";
import { getMood, resolveMoods } from "@/lib/dj/moods";
import { HOT_CUES, MAX_DECKS, MAX_SAVED_LOOPS, MIN_DECKS, type Mood, type MoodId, type Track, type TrackAnalysis, type TrackCues, type TrackFlag, type TrackOverrides } from "@/lib/types";

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
  /**
   * The settings file in the music folder (lib/library/settingsFile.ts): `saved` (kept up to date), `readonly`
   * (the app may not write into the folder yet), `none` (no folder), `error`. `imported`: songs whose edits came
   * from the file the last time it was read.
   */
  settingsFile: { status: "none" | "readonly" | "saved" | "error"; name?: string; savedAt?: number; imported?: { at: number; songs: number; from: string; savedAt: number }; error?: string };
  /** Read the folder's settings file and take it over if it is newer than this computer's last sync. */
  syncSettingsFile: () => Promise<void>;
  /** Let the app write the settings file into the music folder (asks Chrome's "edit files" permission). */
  enableSettingsFile: () => Promise<void>;

  hydrate: () => Promise<void>;
  chooseFolder: () => Promise<void>;
  reconnect: () => Promise<boolean>;
  rescan: () => Promise<void>;
  analyzePending: () => Promise<void>;
  retryFailed: () => Promise<void>;
  setDeckCount: (n: number) => Promise<void>;
  setKeyLock: (on: boolean) => Promise<void>;
  /** Club speakers' master volume (0..1), saved so it survives a reload. Applied to the mix by `useSession.setVolume`. */
  setVolume: (volume: number) => void;
  /** Headphones' volume (previews and Cue, 0..1), saved and applied at once. */
  setPreviewVolume: (volume: number) => void;
  /** Choose the club speakers (mix) and the preview / cue output. */
  setOutputs: (outputs: { mainOutput?: string; previewOutput?: string | null }) => Promise<void>;
  /** Save an edited mood (only the fields that differ from the preset are stored); null resets it. */
  saveMood: (mood: Mood | null, id: MoodId) => Promise<void>;
  /**
   * Fallback when folders can't be opened: add files for this session only. Songs this device has seen before come
   * back with their analysis and edits; a settings file picked with them (ai-dj-mixer-settings.json) brings the
   * analysis and edits it holds, so only new songs are analysed.
   */
  addSessionFiles: (files: File[]) => Promise<void>;
  /** Save the settings file — settings, every song's edits and analysis, session songs too — as a download. */
  downloadSettingsFile: () => void;
  getFile: (track: Track) => Promise<File>;
  markError: (id: string, message: string) => void;
  setFlag: (id: string, flag: TrackFlag | undefined) => Promise<void>;
  setCrates: (id: string, crates: string[]) => Promise<void>;
  /** Save song markers; `null` clears one. */
  setCues: (id: string, cues: { [K in keyof TrackCues]?: number | null }) => Promise<void>;
  /** Save (or clear, with null) hot cue `slot` (0–7) of a song, in track seconds. */
  setHotCue: (id: string, slot: number, seconds: number | null) => Promise<void>;
  /** A song's saved loops (sorted by start, at most MAX_SAVED_LOOPS). */
  setSavedLoops: (id: string, loops: { start: number; end: number }[]) => Promise<void>;
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
/**
 * Other tabs of the app (e.g. the Library open beside the booth) hear about
 * every saved change and reload it, so nothing needs a refresh.
 */
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("ai-dj-mixer") : null;

async function persistTracks(tracks: Record<string, Track>): Promise<void> {
  const keep: Record<string, Track> = {};
  const session: Track[] = [];
  for (const t of Object.values(tracks)) {
    if (!t.path.startsWith(SESSION_PREFIX)) keep[t.id] = t;
    else if (t.status === "ready" && t.analysis) session.push(t);
  }
  await saveTracks(keep);
  // Session songs vanish on reload, but this device remembers their analysis and edits for the next time they're picked.
  if (session.length) {
    const seen = await loadSessionTracks();
    for (const t of session) seen[t.id] = t;
    await saveSessionTracks(seen);
  }
  channel?.postMessage("tracks");
}

/**
 * Take a settings file's analysis for the songs that still need one (matched by content id): they're ready without
 * being analysed here. A fixed beat grid (an override) isn't taken over: those songs are analysed on their grid.
 */
function applyAnalyses(file: SettingsFile): void {
  const tracks = useLibrary.getState().tracks;
  const found = analysesFor(file, tracks);
  const changed: Record<string, Track> = {};
  for (const [id, analysis] of Object.entries(found)) {
    const t = tracks[id];
    if (t.overrides?.bpm !== undefined || t.overrides?.firstBeat !== undefined) continue;
    changed[id] = withAnalysis(t, analysis);
  }
  if (!Object.keys(changed).length) return;
  const next = { ...tracks, ...changed };
  useLibrary.setState({ tracks: next });
  void persistTracks(next);
}

async function persistSettings(settings: Settings): Promise<void> {
  await saveSettings(settings);
  channel?.postMessage("settings");
}

let volumeSave: ReturnType<typeof setTimeout> | undefined;

// The settings file in the music folder: written (debounced) whenever settings or song edits change, once the
// folder's own file has been read (`synced`), so a new computer never overwrites it with an empty one.
let synced: FileSystemDirectoryHandle | null = null;
let lastWritten = "";
let fileTimer: ReturnType<typeof setTimeout> | undefined;

function saveSettingsFileSoon(ms = 1000) {
  // A longer wait never pushes back a write that's already due sooner.
  if (fileTimer && ms > 1000) return;
  clearTimeout(fileTimer);
  fileTimer = setTimeout(() => {
    fileTimer = undefined;
    void writeSettingsNow(false);
  }, ms);
}

async function writeSettingsNow(force: boolean) {
  const s = useLibrary.getState();
  const folder = s.folder;
  if (!folder || s.folderState !== "ready" || synced !== folder) return;
  try {
    if (!(await canWrite(folder))) {
      if (s.settingsFile.status !== "readonly") useLibrary.setState({ settingsFile: { ...s.settingsFile, status: "readonly" } });
      return;
    }
    const file = buildSettingsFile(s.settings, s.tracks, Date.now());
    const key = contentKey(file);
    if (!force && key === lastWritten && s.settingsFile.name === SETTINGS_FILE) return;
    await writeSettingsFile(folder, file);
    lastWritten = key;
    await saveSettingsSync(file.savedAt);
    useLibrary.setState({ settingsFile: { ...useLibrary.getState().settingsFile, status: "saved", name: SETTINGS_FILE, savedAt: file.savedAt } });
  } catch (err) {
    useLibrary.setState({ settingsFile: { status: "error", error: err instanceof Error ? err.message : String(err) } });
  }
}

/** A slider sends many changes: save the settings once it settles. */
function saveSoon() {
  clearTimeout(volumeSave);
  volumeSave = setTimeout(() => void persistSettings(useLibrary.getState().settings), 300);
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
  settingsFile: { status: "none" },

  async hydrate() {
    if (get().hydrated) return;
    const [folder, tracks, settings] = await Promise.all([loadFolderHandle(), loadTracks(), loadSettings()]);
    let folderState: FolderState = "none";
    if (folder) folderState = (await ensurePermission(folder, false)) ? "ready" : "needs-permission";
    // Tracks interrupted mid-analysis go back to pending.
    for (const t of Object.values(tracks)) if (t.status === "pending") t.analysis = null;
    GridPreview.sinkId = settings.previewOutput ?? "";
    sharedPreview.setVolume(settings.previewVolume);
    set({ hydrated: true, folder: folder ?? null, folderState, tracks, settings });
    if (folderState === "ready") await get().syncSettingsFile();
  },

  async chooseFolder() {
    try {
      const folder = await pickFolder();
      await saveFolderHandle(folder);
      synced = null;
      set({ folder, folderState: "ready", error: null, settingsFile: { status: "none" } });
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
    if (ok) {
      await get().syncSettingsFile();
      void get().analyzePending();
    }
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
      // Settings and song edits kept in the folder apply before analysis (a fixed beat grid is analysed as fixed).
      await get().syncSettingsFile();
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
      // Folder by folder, as the Library's Folders view lists them.
      const byPath = (x: Track, y: Track) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: "base" });
      const pendingIds = [...all.filter((t) => t.status === "pending").sort(byPath), ...all.filter(isStale).sort(byPath)].map((t) => t.id);
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
    await persistSettings(settings);
  },

  async setOutputs(outputs) {
    const settings = { ...get().settings, ...outputs };
    set({ settings });
    GridPreview.sinkId = settings.previewOutput ?? "";
    await persistSettings(settings);
  },

  async setKeyLock(on) {
    const settings = { ...get().settings, keyLock: on };
    set({ settings });
    await persistSettings(settings);
  },

  async syncSettingsFile() {
    const { folder, folderState } = get();
    if (!folder || folderState !== "ready") return;
    try {
      const found = await readSettingsFile(folder);
      const writable = await canWrite(folder);
      // Songs the file has an analysis for (by content) don't need analysing here — whatever the file's age.
      if (found) applyAnalyses(found.file);
      if (found && found.file.savedAt > (await loadSettingsSync())) {
        // Newer than this computer's last sync (another computer, or this is a new one): take it over.
        const settings = { ...get().settings, ...found.file.settings };
        const changed = applySettingsFile(found.file, get().tracks);
        for (const [id, t] of Object.entries(changed)) {
          const before = get().tracks[id];
          const gridChanged = t.overrides?.bpm !== before?.overrides?.bpm || t.overrides?.firstBeat !== before?.overrides?.firstBeat;
          // A fixed beat grid is analysed again; a key or drop fix applies to the analysis as it is.
          if (gridChanged && t.analysis) changed[id] = { ...t, status: "pending", analysis: null };
          else if (t.analysis) changed[id] = withAnalysis(t, t.analysis);
        }
        const tracks = { ...get().tracks, ...changed };
        GridPreview.sinkId = settings.previewOutput ?? "";
        sharedPreview.setVolume(settings.previewVolume);
        set({ settings, tracks });
        await persistSettings(settings);
        if (Object.keys(changed).length) await persistTracks(tracks);
        lastWritten = contentKey(buildSettingsFile(settings, tracks, 0));
        await saveSettingsSync(found.file.savedAt);
        set({
          settingsFile: {
            status: writable ? "saved" : "readonly",
            name: found.name,
            savedAt: found.file.savedAt,
            // (Which file it came from, and when that was saved: the app's own file may be written over it later.)
            imported: { at: Date.now(), songs: Object.keys(changed).length, from: found.name, savedAt: found.file.savedAt },
          },
        });
      } else {
        set({ settingsFile: { ...get().settingsFile, status: writable ? "saved" : "readonly", name: found?.name, savedAt: found?.file.savedAt } });
      }
      synced = folder;
      // Write ours if it's missing or this computer has newer changes.
      if (writable) saveSettingsFileSoon();
    } catch (err) {
      set({ settingsFile: { status: "error", error: err instanceof Error ? err.message : String(err) } });
    }
  },

  async enableSettingsFile() {
    const { folder } = get();
    if (!folder) return;
    if (!(await requestWrite(folder))) {
      set({ settingsFile: { ...get().settingsFile, status: "readonly" } });
      return;
    }
    if (synced !== folder) await get().syncSettingsFile();
    await writeSettingsNow(true);
  },

  setVolume(volume) {
    set({ settings: { ...get().settings, volume: Math.max(0, Math.min(1, volume)) } });
    saveSoon();
  },

  setPreviewVolume(volume) {
    const previewVolume = Math.max(0, Math.min(1, volume));
    set({ settings: { ...get().settings, previewVolume } });
    sharedPreview.setVolume(previewVolume);
    saveSoon();
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
    await persistSettings(settings);
  },

  async addSessionFiles(files) {
    // A settings file picked with the songs (from the music's folder on a USB drive, say).
    const picked: SettingsFile[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".json") || file.size > 50_000_000) continue;
      const parsed = parseSettingsFile(await file.text());
      if (parsed) picked.push(parsed);
    }
    if (files.some((f) => f.name.toLowerCase().endsWith(".json")) && !picked.length)
      set({ error: "That .json file isn't an AI DJ Mixer settings file — the songs were added without it." });
    const seen = await loadSessionTracks();
    const tracks = { ...get().tracks };
    for (const file of files) {
      if (!isSupported(file.name)) continue;
      const id = await fileId(file);
      const path = `${SESSION_PREFIX}${file.name}`;
      if (tracks[id]) {
        // Picked again this visit (e.g. after the file input was used twice): keep reading the newest pick.
        if (tracks[id].path === path) sessionFiles.set(path, file);
        continue;
      }
      sessionFiles.set(path, file);
      // Seen on this device before: its analysis and edits come back.
      const known = seen[id];
      tracks[id] = known ? { ...known, path, status: known.analysis ? "ready" : "pending" } : await trackFromFile({ path, file }, id);
    }
    set({ tracks });
    for (const f of picked) {
      // The file's edits for these songs (matched by content), then its analysis for any still to analyse.
      const changed = applySettingsFile(f, get().tracks);
      if (Object.keys(changed).length) set({ tracks: { ...get().tracks, ...changed } });
      applyAnalyses(f);
    }
    void get().analyzePending();
  },

  downloadSettingsFile() {
    const file = buildSettingsFile(get().settings, get().tracks, Date.now(), true);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = SETTINGS_FILE;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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

  async setHotCue(id, slot, seconds) {
    if (slot < 0 || slot >= HOT_CUES) return;
    await patchTrack(id, (t) => {
      const pads = Array.from({ length: HOT_CUES }, (_, i) => t.hotCues?.[i] ?? null);
      pads[slot] = seconds === null ? null : Math.round(seconds * 1000) / 1000;
      return { ...t, hotCues: pads.some((p) => p !== null) ? pads : undefined };
    });
  },

  async setSavedLoops(id, loops) {
    const clean = loops
      .filter((l) => l.end > l.start)
      .map((l) => ({ start: Math.round(l.start * 1000) / 1000, end: Math.round(l.end * 1000) / 1000 }))
      .sort((x, y) => x.start - y.start)
      .slice(0, MAX_SAVED_LOOPS);
    await patchTrack(id, (t) => ({ ...t, savedLoops: clean.length ? clean : undefined }));
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

/**
 * Previews and Cue have their own output, separate from the club speakers, so
 * they can play during a set without the crowd hearing them.
 */
export function previewIsSeparate(s: { mainOutput: string; previewOutput: string | null }): boolean {
  return s.previewOutput !== null && s.previewOutput !== s.mainOutput;
}

export function readyTracks(tracks: Record<string, Track>): Track[] {
  return Object.values(tracks).filter((t) => t.status === "ready" && t.analysis);
}

// Another tab saved settings or track edits: take them over (this tab's session-only files stay).
if (channel) {
  channel.onmessage = async (e: MessageEvent) => {
    if (!useLibrary.getState().hydrated) return;
    if (e.data === "settings") {
      const settings = await loadSettings();
      GridPreview.sinkId = settings.previewOutput ?? "";
      sharedPreview.setVolume(settings.previewVolume);
      useLibrary.setState({ settings });
    } else if (e.data === "tracks") {
      const stored = await loadTracks();
      const session = Object.values(useLibrary.getState().tracks).filter((t) => t.path.startsWith(SESSION_PREFIX));
      useLibrary.setState({ tracks: { ...stored, ...Object.fromEntries(session.map((t) => [t.id, t])) } });
    }
  };
}

// Settings or song edits changed: keep the folder's settings file up to date.
useLibrary.subscribe((state, prev) => {
  // While songs are being analysed the file grows with every one: write it at most every 15 s, and once at the end.
  if (state.analysis === null && prev.analysis !== null) saveSettingsFileSoon();
  else if (state.settings !== prev.settings || state.tracks !== prev.tracks) saveSettingsFileSoon(state.analysis ? 15_000 : 1000);
});
