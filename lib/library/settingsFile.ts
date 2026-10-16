// The settings file kept in the music folder (ai-dj-mixer-settings.json), so the
// club's setup travels with its music: the app's settings and every song's
// edits — flags, crates, markers (cue in / cue out, hook, dialogue), cue pads,
// saved loops and beat-grid / key / drop fixes. Not the analysis (it is redone
// on any computer) and not the audio devices (they differ per computer). Songs
// are matched by their content id (renames and moves keep their edits), else by
// path. PURE.

import type { Settings } from "./store";
import { HOT_CUES, MAX_DECKS, MAX_SAVED_LOOPS, MIN_DECKS, type Track, type TrackCues, type TrackOverrides } from "@/lib/types";

export const SETTINGS_FILE = "ai-dj-mixer-settings.json";
const APP = "ai-dj-mixer";
const VERSION = 1;

/** The settings that make sense on another computer. */
export type PortableSettings = Pick<Settings, "deckCount" | "keyLock" | "moods" | "volume" | "previewVolume">;

/** What staff and the admin changed on a song. */
export interface TrackEdits {
  /** Where the song was (to match it if the file changed), and its title (for people reading the file). */
  path: string;
  title: string;
  flag?: Track["flag"];
  crates?: string[];
  cues?: TrackCues;
  hotCues?: (number | null)[];
  savedLoops?: { start: number; end: number }[];
  overrides?: TrackOverrides;
}

export interface SettingsFile {
  app: typeof APP;
  version: number;
  /** When it was written (ms since 1970). */
  savedAt: number;
  settings: PortableSettings;
  tracks: Record<string, TrackEdits>;
}

const EDIT_KEYS = ["flag", "crates", "cues", "hotCues", "savedLoops", "overrides"] as const;

/** A song's edits, or null if it has none. */
export function editsOf(t: Track): TrackEdits | null {
  const e: TrackEdits = { path: t.path, title: t.title };
  let any = false;
  for (const k of EDIT_KEYS) {
    if (t[k] !== undefined) {
      (e as unknown as Record<string, unknown>)[k] = t[k];
      any = true;
    }
  }
  return any ? e : null;
}

/** The file for the current settings and songs (session-only files are left out). */
export function buildSettingsFile(settings: Settings, tracks: Record<string, Track>, savedAt: number): SettingsFile {
  const edits: Record<string, TrackEdits> = {};
  for (const t of Object.values(tracks).sort((a, b) => a.path.localeCompare(b.path))) {
    if (t.path.startsWith("session:")) continue;
    const e = editsOf(t);
    if (e) edits[t.id] = e;
  }
  const { deckCount, keyLock, moods, volume, previewVolume } = settings;
  return { app: APP, version: VERSION, savedAt, settings: { deckCount, keyLock, moods, volume, previewVolume }, tracks: edits };
}

/** What a file holds, ignoring when it was saved (to tell whether anything changed). */
export function contentKey(f: SettingsFile): string {
  return JSON.stringify({ settings: f.settings, tracks: f.tracks });
}

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Read a settings file, keeping only what makes sense; null if it isn't one of ours. */
export function parseSettingsFile(text: string): SettingsFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const f = obj(raw);
  if (!f || f.app !== APP || typeof f.version !== "number" || f.version > VERSION) return null;
  const s = obj(f.settings) ?? {};
  const settings: Partial<PortableSettings> = {};
  const deckCount = num(s.deckCount, MIN_DECKS, MAX_DECKS);
  if (deckCount !== undefined) settings.deckCount = Math.round(deckCount);
  if (typeof s.keyLock === "boolean") settings.keyLock = s.keyLock;
  if (obj(s.moods)) settings.moods = s.moods as PortableSettings["moods"];
  const volume = num(s.volume, 0, 1);
  if (volume !== undefined) settings.volume = volume;
  const previewVolume = num(s.previewVolume, 0, 1);
  if (previewVolume !== undefined) settings.previewVolume = previewVolume;

  const tracks: Record<string, TrackEdits> = {};
  for (const [id, value] of Object.entries(obj(f.tracks) ?? {})) {
    const e = obj(value);
    if (!e || typeof e.path !== "string") continue;
    const edits: TrackEdits = { path: e.path, title: typeof e.title === "string" ? e.title : e.path };
    if (e.flag === "ban" || e.flag === "favourite") edits.flag = e.flag;
    if (Array.isArray(e.crates)) edits.crates = e.crates.filter((c): c is string => typeof c === "string");
    const cues = obj(e.cues);
    if (cues) {
      const c: TrackCues = {};
      for (const k of ["start", "end", "hookStart", "hookEnd", "dialogueStart", "dialogueEnd"] as const) {
        const v = num(cues[k], 0, 36_000);
        if (v !== undefined) c[k] = v;
      }
      if (Object.keys(c).length) edits.cues = c;
    }
    if (Array.isArray(e.hotCues)) edits.hotCues = e.hotCues.slice(0, HOT_CUES).map((v) => num(v, 0, 36_000) ?? null);
    if (Array.isArray(e.savedLoops))
      edits.savedLoops = e.savedLoops
        .map((l) => obj(l))
        .filter((l): l is Record<string, unknown> => !!l)
        .map((l) => ({ start: num(l.start, 0, 36_000) ?? -1, end: num(l.end, 0, 36_000) ?? -1 }))
        .filter((l) => l.start >= 0 && l.end > l.start)
        .slice(0, MAX_SAVED_LOOPS);
    const o = obj(e.overrides);
    if (o) {
      const ov: TrackOverrides = {};
      const bpm = num(o.bpm, 40, 250);
      if (bpm !== undefined) ov.bpm = bpm;
      const firstBeat = num(o.firstBeat, 0, 36_000);
      if (firstBeat !== undefined) ov.firstBeat = firstBeat;
      const fullLevel = num(o.fullLevel, 0, 1);
      if (fullLevel !== undefined) ov.fullLevel = fullLevel;
      if (typeof o.key === "string") ov.key = o.key;
      if (Object.keys(ov).length) edits.overrides = ov;
    }
    tracks[id] = edits;
  }
  return { app: APP, version: VERSION, savedAt: num(f.savedAt, 0, 1e15) ?? 0, settings: settings as PortableSettings, tracks };
}

/**
 * The songs with the file's edits applied (matched by id, else by path). Edits
 * the file has replace this computer's; songs it doesn't mention are left alone.
 * Returns the songs that changed.
 */
export function applySettingsFile(file: SettingsFile, tracks: Record<string, Track>): Record<string, Track> {
  const byPath = new Map(Object.values(tracks).map((t) => [t.path, t]));
  const changed: Record<string, Track> = {};
  for (const [id, e] of Object.entries(file.tracks)) {
    const t = tracks[id] ?? byPath.get(e.path);
    if (!t) continue;
    const next: Track = { ...t };
    for (const k of EDIT_KEYS) {
      if (e[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = e[k];
      else delete (next as unknown as Record<string, unknown>)[k];
    }
    if (JSON.stringify(editsOf(next)) !== JSON.stringify(editsOf(t))) changed[t.id] = next;
  }
  return changed;
}
