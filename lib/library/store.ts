// Persistence in IndexedDB (via idb-keyval). Everything the booth needs to
// restart unattended lives here: the folder handle, track analysis, settings
// and the last session. Client-only.

import { createStore, del, get, set, update } from "idb-keyval";
import type { MoodOverrides } from "@/lib/dj/moods";
import type { MoodId, SetLogEntry, Track } from "@/lib/types";
import { MAX_LOG_ENTRIES } from "./setlog";

const db = typeof indexedDB !== "undefined" ? createStore("ai-dj-mixer", "kv") : undefined;

const KEYS = {
  folder: "library:folder",
  tracks: "library:tracks",
  settings: "settings",
  session: "session:last",
  setLog: "setlog",
} as const;

export interface Settings {
  deckCount: number;
  /** Keep tracks at their original key while tempo-syncing (AudioWorklet, beta). */
  keyLock: boolean;
  /** Admin edits to the mood presets. */
  moods: MoodOverrides;
  /** Output for the mix: the club speakers (PA), e.g. Bluetooth or the 3.5 mm jack. "" = system default. */
  mainOutput: string;
  /** Output for previews and Cue (headphones), e.g. USB-C or HDMI. null = not chosen (previews use the default). */
  previewOutput: string | null;
  /** Master volume on the club speakers, 0..1 (the booth's volume slider). */
  volume: number;
}

export interface LastSession {
  mood: MoodId;
  playing: boolean;
  /** Staff-requested track ids still waiting (restored after a reload). */
  queue?: string[];
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = { deckCount: 2, keyLock: false, moods: {}, mainOutput: "", previewOutput: null, volume: 1 };

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return db ? get<FileSystemDirectoryHandle>(KEYS.folder, db) : undefined;
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (db) await set(KEYS.folder, handle, db);
}

export async function clearFolderHandle(): Promise<void> {
  if (db) await del(KEYS.folder, db);
}

export async function loadTracks(): Promise<Record<string, Track>> {
  return (db ? await get<Record<string, Track>>(KEYS.tracks, db) : undefined) ?? {};
}

export async function saveTracks(tracks: Record<string, Track>): Promise<void> {
  if (db) await set(KEYS.tracks, tracks, db);
}

export async function loadSettings(): Promise<Settings> {
  const s = db ? await get<Settings>(KEYS.settings, db) : undefined;
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (db) await set(KEYS.settings, settings, db);
}

export async function appendSetLog(entry: SetLogEntry): Promise<void> {
  if (!db) return;
  await update<SetLogEntry[]>(KEYS.setLog, (log = []) => [...log, entry].slice(-MAX_LOG_ENTRIES), db);
}

export async function loadSetLog(): Promise<SetLogEntry[]> {
  return (db ? await get<SetLogEntry[]>(KEYS.setLog, db) : undefined) ?? [];
}

export async function clearSetLog(): Promise<void> {
  if (db) await del(KEYS.setLog, db);
}

export async function loadLastSession(): Promise<LastSession | undefined> {
  return db ? get<LastSession>(KEYS.session, db) : undefined;
}

export async function saveLastSession(session: LastSession): Promise<void> {
  if (db) await set(KEYS.session, session, db);
}
