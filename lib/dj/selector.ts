// Rule-based track selection. Pure functions only — no audio, no browser APIs —
// so every decision the auto-DJ makes can be unit-tested.

import { keyCompatibility } from "@/lib/analysis/key";
import type { Mood, Track, TransitionKind } from "@/lib/types";

/** Max tempo change we will beat-match across (playbackRate ±8%). */
export const MAX_SYNC_DELTA = 0.08;
/** Tracks played this recently are never repeated. */
export const NO_REPEAT_WINDOW = 30;
/** Artists played this recently are penalised. */
export const ARTIST_WINDOW = 3;
/** Beat grids below this confidence only get cut / echo-out transitions. */
export const MIN_BLEND_CONFIDENCE = 0.35;

export const WEIGHTS = {
  key: 0.2,
  tempo: 0.3,
  energy: 0.25,
  mood: 0.25,
  artistPenalty: 0.3,
  /** Bonus for tracks the admin marked as favourites. */
  favourite: 0.1,
} as const;

export interface SelectionContext {
  mood: Mood;
  /** Track currently playing (null at the start of a set). */
  current: Track | null;
  /** Effective BPM of the current deck (track BPM × playback rate). */
  currentBpm: number | null;
  targetEnergy: number;
  /** Track ids, most recent first. */
  history: string[];
  /** Artists, most recent first. */
  recentArtists: string[];
  /**
   * True right after staff switch to a mood whose tempo band is far from the
   * current tempo: score tempo against the mood instead of the current track,
   * and the transition will be an echo-out rather than a blend.
   */
  jump: boolean;
}

export interface ScoreBreakdown {
  total: number;
  key: number;
  tempo: number;
  energy: number;
  mood: number;
  artistPenalty: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Tempo difference as a fraction of `fromBpm`. Half/double-time matches are
 * deliberately not treated as close: the engine syncs by playbackRate, which
 * can only bridge about ±8%.
 */
export function tempoDelta(fromBpm: number, toBpm: number): number {
  return Math.abs(toBpm - fromBpm) / fromBpm;
}

function bandFit(value: number, [lo, hi]: [number, number], falloff: number): number {
  if (value >= lo && value <= hi) return 1;
  const dist = value < lo ? lo - value : value - hi;
  return clamp01(1 - dist / falloff);
}

export function moodFit(track: Track, mood: Mood): number {
  const a = track.analysis;
  if (!a) return 0;
  const bpmFit = bandFit(a.bpm, mood.bpm, 10);
  const genres = track.genres.map((g) => g.toLowerCase());
  const genreFit =
    genres.length === 0 ? 0.5 : genres.some((g) => mood.genres.some((m) => g.includes(m))) ? 1 : 0.2;
  return 0.6 * bpmFit + 0.4 * genreFit;
}

export function scoreTrack(track: Track, ctx: SelectionContext): ScoreBreakdown {
  const a = track.analysis;
  if (!a) return { total: -Infinity, key: 0, tempo: 0, energy: 0, mood: 0, artistPenalty: 0 };

  const moodMid = (ctx.mood.bpm[0] + ctx.mood.bpm[1]) / 2;
  const refBpm = ctx.jump || ctx.currentBpm === null ? moodMid : ctx.currentBpm;
  const tempo = clamp01(1 - tempoDelta(refBpm, a.bpm) / MAX_SYNC_DELTA);
  const key = keyCompatibility(ctx.current?.camelot ?? null, track.camelot);
  const energy = clamp01(1 - Math.abs(a.energy - ctx.targetEnergy) * 2);
  const mood = moodFit(track, ctx.mood);
  const artist = track.artist.trim().toLowerCase();
  const artistPenalty =
    artist && ctx.recentArtists.slice(0, ARTIST_WINDOW).some((r) => r.trim().toLowerCase() === artist)
      ? WEIGHTS.artistPenalty
      : 0;

  const total =
    WEIGHTS.key * key +
    WEIGHTS.tempo * tempo +
    WEIGHTS.energy * energy +
    WEIGHTS.mood * mood -
    artistPenalty +
    (track.flag === "favourite" ? WEIGHTS.favourite : 0);
  return { total, key, tempo, energy, mood, artistPenalty };
}

/** Playable at all: analysed and not banned. */
export function playable(t: Track): boolean {
  return t.status === "ready" && !!t.analysis && t.flag !== "ban";
}

/** The mood's crates, if it is limited to some and any of them has playable tracks. */
function inMoodCrates(tracks: Track[], mood: Mood): Track[] {
  const crates = mood.crates ?? [];
  if (crates.length === 0) return tracks;
  const limited = tracks.filter((t) => t.crates?.some((c) => crates.includes(c)));
  return limited.length > 0 ? limited : tracks;
}

/**
 * Candidates that may be played next: playable, in the mood's crates (if it
 * has any with tracks), not recently played, not current.
 */
export function eligible(tracks: Track[], ctx: SelectionContext, exclude: Set<string> = new Set()): Track[] {
  const recent = new Set(ctx.history.slice(0, NO_REPEAT_WINDOW));
  const all = inMoodCrates(tracks.filter(playable), ctx.mood);
  let pool = all.filter((t) => !recent.has(t.id) && !exclude.has(t.id) && t.id !== ctx.current?.id);
  if (pool.length === 0) {
    // Small library: allow repeats, but never the current or excluded track.
    pool = all.filter((t) => !exclude.has(t.id) && t.id !== ctx.current?.id);
  }
  return pool;
}

/** Rank candidates, best first. */
export function rankCandidates(tracks: Track[], ctx: SelectionContext, exclude?: Set<string>) {
  return eligible(tracks, ctx, exclude)
    .map((track) => ({ track, score: scoreTrack(track, ctx) }))
    .sort((x, y) => y.score.total - x.score.total);
}

export function pickNext(tracks: Track[], ctx: SelectionContext, exclude?: Set<string>): Track | null {
  return rankCandidates(tracks, ctx, exclude)[0]?.track ?? null;
}

export interface RequestOption {
  track: Track;
  /** Same score the auto-DJ uses (mood, tempo, key, energy). */
  score: number;
  moodFit: number;
  /** Played within the no-repeat window. */
  recent: boolean;
  /** Close enough in tempo to beat-match from the playing track. */
  syncable: boolean;
}

/**
 * Every playable track for the staff track picker, the best fit for the mood
 * and the playing track first. Unlike `eligible`, recently played tracks are
 * kept (listed last and flagged) — staff may want a request again.
 */
export function rankForRequest(tracks: Track[], ctx: SelectionContext): RequestOption[] {
  const recent = new Set(ctx.history.slice(0, NO_REPEAT_WINDOW));
  return tracks
    .filter((t) => playable(t) && t.id !== ctx.current?.id)
    .map((track) => ({
      track,
      score: scoreTrack(track, ctx).total,
      moodFit: moodFit(track, ctx.mood),
      recent: recent.has(track.id),
      syncable: ctx.currentBpm === null || tempoDelta(ctx.currentBpm, track.analysis!.bpm) <= MAX_SYNC_DELTA,
    }))
    .sort((x, y) => Number(x.recent) - Number(y.recent) || y.score - x.score);
}

/** Pick the transition recipe between the playing track and the incoming one. */
export function chooseTransition(
  current: Track,
  next: Track,
  currentBpm: number,
  jump: boolean,
): TransitionKind {
  const a = current.analysis;
  const b = next.analysis;
  if (!a || !b) return "cut";
  if (a.beatConfidence < MIN_BLEND_CONFIDENCE || b.beatConfidence < MIN_BLEND_CONFIDENCE) return "cut";
  if (jump || Math.abs(currentBpm / b.bpm - 1) > MAX_SYNC_DELTA) return "echoOut";
  if (keyCompatibility(current.camelot, next.camelot) < 0.5) return "filterSweep";
  return "blend";
}

/** True when the new mood's tempo band is too far from the current tempo to ramp smoothly. */
export function isMoodJump(currentBpm: number | null, mood: Mood): boolean {
  if (currentBpm === null) return false;
  const [lo, hi] = mood.bpm;
  if (currentBpm >= lo && currentBpm <= hi) return false;
  const edge = currentBpm < lo ? lo : hi;
  return Math.abs(edge - currentBpm) / currentBpm > MAX_SYNC_DELTA;
}
