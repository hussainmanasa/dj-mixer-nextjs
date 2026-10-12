// Persistence in IndexedDB (via idb-keyval). Everything the booth needs to
// restart unattended lives here: the folder handle, track analysis, settings
// and the last session. Client-only.

import { createStore, del, get, set } from "idb-keyval";
import type { MoodId, Track } from "@/lib/types";

const db = typeof indexedDB !== "undefined" ? createStore("ai-dj-mixer", "kv") : undefined;

const KEYS = {
  folder: "library:folder",
  tracks: "library:tracks",
  settings: "settings",
  session: "session:last",
} as const;

export interface Settings {
  deckCount: number;
}

export interface LastSession {
  mood: MoodId;
  playing: boolean;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = { deckCount: 2 };

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

export async function loadLastSession(): Promise<LastSession | undefined> {
  return db ? get<LastSession>(KEYS.session, db) : undefined;
}

export async function saveLastSession(session: LastSession): Promise<void> {
  if (db) await set(KEYS.session, session, db);
}
