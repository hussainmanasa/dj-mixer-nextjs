"use client";

// Library state: the connected music folder, every track and its analysis,
// and booth settings. Used by the admin library page and by the auto-DJ.

import { create } from "zustand";
import { analyzeFile } from "@/lib/analysis/analyze";
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
import { MAX_DECKS, MIN_DECKS, type Track } from "@/lib/types";

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
  /** Fallback when folders can't be opened: add files for this session only. */
  addSessionFiles: (files: File[]) => Promise<void>;
  getFile: (track: Track) => Promise<File>;
  markError: (id: string, message: string) => void;
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
      const pendingIds = Object.values(get().tracks)
        .filter((t) => t.status === "pending")
        .map((t) => t.id);
      let done = 0;
      for (const id of pendingIds) {
        const track = get().tracks[id];
        if (!track) continue;
        set({ analysis: { done, total: pendingIds.length, current: track.title } });
        let updated: Track;
        try {
          const file = await get().getFile(track);
          const analysis = await analyzeFile(file, track.tagBpm);
          updated = { ...track, analysis, status: "ready", error: undefined };
        } catch (err) {
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

  markError(id, message) {
    const t = get().tracks[id];
    if (!t) return;
    const tracks = { ...get().tracks, [id]: { ...t, status: "error" as const, error: message } };
    set({ tracks });
    void persistTracks(tracks);
  },
}));

export function readyTracks(tracks: Record<string, Track>): Track[] {
  return Object.values(tracks).filter((t) => t.status === "ready" && t.analysis);
}
