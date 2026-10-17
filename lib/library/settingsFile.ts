// The settings file kept in the music folder (ai-dj-mixer-settings.json), so the
// club's setup travels with its music: the app's settings, every song's edits —
// flags, crates, markers (cue in / cue out, hook, dialogue), cue pads, saved loops
// and beat-grid / key / drop fixes — and every song's analysis (tempo, grid, drops,
// loudness, key), so another computer or an iPad doesn't analyse the music again.
// Not the audio devices (they differ per computer). Edits are matched by the song's
// content id (renames and moves keep them), else by path; analysis only by content
// id (a changed file is analysed again). PURE.

import type { Settings } from "./store";
import { ANALYSIS_VERSION } from "@/lib/analysis/bpm";
import { HOT_CUES, MAX_DECKS, MAX_SAVED_LOOPS, MIN_DECKS, type Track, type TrackAnalysis, type TrackCues, type TrackOverrides } from "@/lib/types";

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
  /**
   * Each analysed song's analysis, by content id (its `title` for people reading the file). Optional: files from
   * before it was added have none, and older versions of the app ignore it.
   */
  analysis?: Record<string, { title: string; analysis: TrackAnalysis }>;
}

/** A session-only song (picked for this visit) is kept as "session:<file name>": in a file it is just its name. */
const SESSION = "session:";
const plainPath = (path: string) => (path.startsWith(SESSION) ? path.slice(SESSION.length) : path);

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

/**
 * The file for the current settings and songs. The file kept in the music folder leaves out session-only songs (they
 * aren't in that folder); a file to download (`withSession`) has them too, under their file names.
 */
export function buildSettingsFile(settings: Settings, tracks: Record<string, Track>, savedAt: number, withSession = false): SettingsFile {
  const edits: Record<string, TrackEdits> = {};
  const analysis: NonNullable<SettingsFile["analysis"]> = {};
  for (const t of Object.values(tracks).sort((a, b) => a.path.localeCompare(b.path))) {
    if (t.path.startsWith(SESSION) && !withSession) continue;
    const e = editsOf(t);
    if (e) edits[t.id] = { ...e, path: plainPath(e.path) };
    if (t.status === "ready" && t.analysis) analysis[t.id] = { title: t.title, analysis: compactAnalysis(t.analysis) };
  }
  const { deckCount, keyLock, moods, volume, previewVolume } = settings;
  return { app: APP, version: VERSION, savedAt, settings: { deckCount, keyLock, moods, volume, previewVolume }, tracks: edits, analysis };
}

/** An analysis as stored in the file: per-song admin values left out (they live in the edits), levels rounded. */
function compactAnalysis(a: TrackAnalysis): TrackAnalysis {
  const r = (v: number, d = 1000) => Math.round(v * d) / d;
  const out: TrackAnalysis = { ...a };
  delete out.fullLevel;
  if (a.barLevels) out.barLevels = a.barLevels.map((v) => r(v));
  return out;
}

/** What a file holds, ignoring when it was saved and the order of fields (to tell whether anything changed). */
export function contentKey(f: SettingsFile): string {
  return stable({ settings: f.settings, tracks: f.tracks, analysis: f.analysis ?? {} });
}

/** JSON with every object's keys sorted. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Read one stored analysis, or null if it isn't a complete, current one (an older one is redone anyway). */
function parseAnalysis(v: unknown): TrackAnalysis | null {
  const a = obj(v);
  if (!a) return null;
  const bpm = num(a.bpm, 30, 300);
  const firstBeat = num(a.firstBeat, 0, 36_000);
  const beatConfidence = num(a.beatConfidence, 0, 1);
  const energy = num(a.energy, 0, 1);
  const duration = num(a.duration, 0.1, 36_000);
  const introEnd = num(a.introEnd, 0, 36_000);
  const outroStart = num(a.outroStart, 0, 36_000);
  const version = num(a.version, 1, 1000);
  if (bpm === undefined || firstBeat === undefined || beatConfidence === undefined || energy === undefined) return null;
  if (duration === undefined || introEnd === undefined || outroStart === undefined) return null;
  if (version === undefined || version < ANALYSIS_VERSION) return null;
  const out: TrackAnalysis = { bpm, firstBeat, beatConfidence, energy, duration, introEnd, outroStart, version };
  if (Array.isArray(a.barLevels)) out.barLevels = a.barLevels.map((x) => num(x, 0, 10) ?? 0);
  const loudness = num(a.loudness, -200, 50);
  if (loudness !== undefined) out.loudness = loudness;
  if (typeof a.detectedKey === "string" || a.detectedKey === null) out.detectedKey = a.detectedKey;
  const keyConfidence = num(a.keyConfidence, 0, 1);
  if (keyConfidence !== undefined) out.keyConfidence = keyConfidence;
  for (const k of ["suggestedHook", "suggestedDialogue"] as const) {
    if (a[k] === null) out[k] = null;
    const range = obj(a[k]);
    const start = num(range?.start, 0, 36_000);
    const end = num(range?.end, 0, 36_000);
    if (range && start !== undefined && end !== undefined && end > start) out[k] = { ...(range as object), start, end } as TrackAnalysis[typeof k];
  }
  return out;
}

/**
 * The file's analysis for songs that still need one — not analysed yet, or analysed by an older version — matched
 * by content id only. Returns id → analysis.
 */
export function analysesFor(file: SettingsFile, tracks: Record<string, Track>): Record<string, TrackAnalysis> {
  const out: Record<string, TrackAnalysis> = {};
  for (const [id, entry] of Object.entries(file.analysis ?? {})) {
    const t = tracks[id];
    if (!t) continue;
    const needs = t.status === "pending" || !t.analysis || (t.analysis.version ?? 1) < ANALYSIS_VERSION;
    if (needs) out[id] = entry.analysis;
  }
  return out;
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
  const analysis: NonNullable<SettingsFile["analysis"]> = {};
  for (const [id, value] of Object.entries(obj(f.analysis) ?? {})) {
    const entry = obj(value);
    const a = parseAnalysis(entry?.analysis);
    if (a) analysis[id] = { title: typeof entry?.title === "string" ? entry.title : "", analysis: a };
  }
  return { app: APP, version: VERSION, savedAt: num(f.savedAt, 0, 1e15) ?? 0, settings: settings as PortableSettings, tracks, analysis };
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
