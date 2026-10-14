// Shared domain types for the auto-DJ. Keep this file free of browser APIs so
// it can be imported from server components, workers and tests alike.

export type MoodId = "chill" | "warmup" | "groove" | "peak" | "afterhours" | "desi";

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
  /** Only play tracks from these crates (empty or missing: the whole library). */
  crates?: string[];
  /** Mix out when the track breaks down after this many drops (fewer drops → play to the outro). */
  mixOutAfterDrops: number;
  /** Tracks with no breakdowns at all are mixed out after this many bars (a multiple of 8). */
  maxPlayBars: number;
  /**
   * Mix like a peak-time DJ: instead of a long blend, bring the next track in on
   * its drop exactly where the current one breaks down (a drop swap).
   */
  dropSwap: boolean;
  /**
   * Open the set (only when it starts in this mood) with a slow song from these
   * crates, played from its hook; when the hook ends, drop into the party.
   */
  opener?: { crates: string[]; maxBpm: number };
  /**
   * After the opener, keep each song playing until staff press Drop. It still
   * mixes out near its end if nobody does — the music never stops.
   */
  holdForDrop?: boolean;
  /**
   * Beat-match at half and double tempo too (a 64 BPM ballad against a 128 BPM
   * party track: one ballad beat per two party beats). Common in Bollywood sets.
   */
  halfTime?: boolean;
  /** On a big tempo jump, rewind (spin back) the outgoing song instead of echoing it out. */
  rewind?: boolean;
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
  /**
   * Bass level of each bar from `firstBeat`, 0..1 (1 = the track's loud bars).
   * Breakdowns and drops are found from this (lib/analysis/structure.ts).
   * Missing in analyses made before version 2.
   */
  barLevels?: number[];
  /** ANALYSIS_VERSION that produced this result; missing means 1. */
  version?: number;
  /** Integrated loudness on the analysis scale (see lib/analysis/loudness.ts). Version 3+. */
  loudness?: number;
  /** Key detected from the audio (Camelot), used when the file has no key tag. Version 3+. */
  detectedKey?: string | null;
  keyConfidence?: number;
  /** Per-track drop-detection threshold from the admin (TrackOverrides.fullLevel). */
  fullLevel?: number;
  /** Markers the analysis suggests (version 4+). Never used until the admin accepts them. */
  suggestedHook?: SuggestedRange | null;
  suggestedDialogue?: SuggestedRange | null;
}

/** A marker suggested by the analysis, in track seconds; the admin accepts it in the track editor. */
export interface SuggestedRange {
  start: number;
  end: number;
  /** 0..1, how clearly it stood out. */
  confidence: number;
}

/** Admin fixes for one track; they survive re-analysis. */
export interface TrackOverrides {
  /** Corrected beat grid: the track is re-analysed on this grid. */
  bpm?: number;
  firstBeat?: number;
  /** Drop-detection threshold (lower = more bars count as full). */
  fullLevel?: number;
  /** Key set by hand (Camelot), overriding tags and detection. */
  key?: string;
}

export type TrackFlag = "ban" | "favourite";

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
  /** Where `camelot` came from; "audio" when detected because the file had no key tag. */
  keySource?: "tag" | "audio" | "manual";
  /** The key from the file's tags, kept so a cleared manual key can fall back to it. */
  tagKey?: string;
  analysis: TrackAnalysis | null;
  overrides?: TrackOverrides;
  /** Banned tracks are never played; favourites are picked a little more often. */
  flag?: TrackFlag;
  /** Admin groupings (e.g. "Bollywood", "Friday"); moods can be limited to crates. */
  crates?: string[];
  /** Song markers set by the admin (dialogue, hook, default start). */
  cues?: TrackCues;
  status: TrackStatus;
  error?: string;
  addedAt: number;
}

/**
 * `drop`: the next track comes in on its drop (staff Drop, drop swaps).
 * `dialogue`: the next track's dialogue plays, then it jumps straight to its drop.
 * `rewind`: the outgoing track spins back, then the next one hits (big tempo jumps).
 */
export type TransitionKind = "blend" | "filterSweep" | "echoOut" | "cut" | "drop" | "dialogue" | "rewind";

/** Song markers, in track seconds. Set by the admin in the track editor; they survive re-analysis. */
export interface TrackCues {
  /** Where the song starts when nothing else applies (on a downbeat). */
  start?: number;
  /** The hook / chorus (mukhda), on downbeats. */
  hookStart?: number;
  hookEnd?: number;
  /** A dialogue in the track (exact times — speech isn't on the beat). The drop follows it. */
  dialogueStart?: number;
  dialogueEnd?: number;
}

/** Where staff want the cued song to come in from (booth "Start from"). */
export type EntryChoice =
  | { kind: "auto" }
  | { kind: "beginning" }
  | { kind: "dialogue" }
  | { kind: "hook" }
  | { kind: "drop" }
  | { kind: "bar"; bar: number };

/** One track played, for the set log (licence reports). */
export interface SetLogEntry {
  /** When it started playing (ms since epoch). */
  at: number;
  trackId: string;
  title: string;
  artist: string;
  path: string;
  mood: MoodId;
  /** How it came in: a transition, the first track of a set, or an automatic recovery. */
  how: TransitionKind | "start" | "recovery";
  requested: boolean;
  bpm: number;
  key: string | null;
  /** Track length in seconds (caps the "played" time in reports). */
  duration: number;
}

export const SUPPORTED_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".oga", ".opus"] as const;

export const MIN_DECKS = 2;
export const MAX_DECKS = 4;
