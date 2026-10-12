// Shared domain types for the auto-DJ. Keep this file free of browser APIs so
// it can be imported from server components, workers and tests alike.

export type MoodId = "chill" | "warmup" | "groove" | "peak" | "afterhours";

export interface Mood {
  id: MoodId;
  name: string;
  description: string;
  /** Preferred tempo band in BPM (inclusive). */
  bpm: [number, number];
  /** Preferred energy band, 0..1. */
  energy: [number, number];
  /** Lower-case genre keywords that count as a mood match. */
  genres: string[];
  /** Length of a normal beat-matched blend, in bars (4 beats per bar). */
  blendBars: number;
}

/** Result of offline audio analysis (lib/analysis). Times are track seconds. */
export interface TrackAnalysis {
  bpm: number;
  /** Time of the first detected downbeat; the beat grid starts here. */
  firstBeat: number;
  /** 0..1 — how clearly the beat grid stood out. Low values disable long blends. */
  beatConfidence: number;
  /** 0..1 — loudness + onset density. */
  energy: number;
  duration: number;
  /** End of the quiet intro (first bar at near-full level). */
  introEnd: number;
  /** Start of the quiet outro (after the last bar at near-full level). */
  outroStart: number;
}

export type TrackStatus = "pending" | "ready" | "error";

export interface Track {
  /** Content hash; stable across renames and re-scans. */
  id: string;
  /** Path relative to the library root folder, e.g. "House/track.mp3". */
  path: string;
  title: string;
  artist: string;
  genres: string[];
  /** Camelot notation, e.g. "8A". Null when the file has no key tag. */
  camelot: string | null;
  /** BPM from the file's tags, if any (used as a hint). */
  tagBpm: number | null;
  analysis: TrackAnalysis | null;
  status: TrackStatus;
  error?: string;
  addedAt: number;
}

export type TransitionKind = "blend" | "filterSweep" | "echoOut" | "cut";

export const SUPPORTED_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus"] as const;

export const MIN_DECKS = 2;
export const MAX_DECKS = 4;
