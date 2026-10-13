// Where to start and end transitions on a track's beat grid. Pure functions.

import { drops } from "@/lib/analysis/structure";
import type { Mood, TrackAnalysis } from "@/lib/types";

export const BEATS_PER_BAR = 4;
/** Phrases in dance music are usually 8 or 16 bars; we align mix-outs to 8. */
export const PHRASE_BARS = 8;

/** The parts of a mood that decide how long a track plays. */
export type MixOutRule = Pick<Mood, "mixOutAfterDrops" | "maxPlayBars">;

export function beatSeconds(a: TrackAnalysis): number {
  return 60 / a.bpm;
}

export function barSeconds(a: TrackAnalysis): number {
  return beatSeconds(a) * BEATS_PER_BAR;
}

/** Track position (s) where the incoming track starts playing: its first downbeat. */
export function cueIn(a: TrackAnalysis): number {
  return a.firstBeat;
}

/**
 * Track position (s) where the outgoing track should begin its mix-out so that
 * a `blendBars` transition ends before the audio runs out.
 *
 * With a `rule` (the mood) and the track's bar levels, the track plays until
 * it breaks down after its `rule.mixOutAfterDrops`-th drop. The transition
 * starts `leadBars` before that breakdown so its hand-over (the bass swap of
 * a blend) lands where the outgoing track drops out. A track with no
 * breakdowns at all leaves after `rule.maxPlayBars`.
 *
 * Otherwise (no rule, no bar levels, too few drops) it picks the last phrase
 * boundary (multiple of 8 bars from the first downbeat) at or before the
 * outro, keeping at least `blendBars` + 1 bars of audio after it.
 *
 * Never returns a point earlier than `notBefore`.
 */
export function mixOutPoint(
  a: TrackAnalysis,
  blendBars: number,
  notBefore = 0,
  rule?: MixOutRule,
  leadBars = Math.floor(blendBars / 2),
): number {
  const bar = barSeconds(a);
  const totalBars = Math.floor((a.duration - a.firstBeat) / bar);
  const latestBar = totalBars - blendBars - 1;
  if (latestBar <= 0) return Math.max(notBefore, a.firstBeat);

  if (rule && a.barLevels) {
    const earliestBar = Math.max(0, Math.ceil((notBefore - a.firstBeat) / bar));
    const structural = structureMixOutBar(a.barLevels, a.fullLevel, rule, leadBars, earliestBar, latestBar);
    if (structural !== null) return a.firstBeat + structural * bar;
  }

  const outroBar = Math.floor((a.outroStart - a.firstBeat) / bar);
  // Start the blend so it finishes around the outro, but never past latestBar.
  let target = Math.min(latestBar, Math.max(0, outroBar - Math.floor(blendBars / 2)));
  target = Math.floor(target / PHRASE_BARS) * PHRASE_BARS;
  if (target <= 0) target = latestBar;

  let pos = a.firstBeat + target * bar;
  if (pos < notBefore) {
    // Too early (e.g. the track was started late): use the next bar after notBefore.
    const barsAfter = Math.ceil((notBefore - a.firstBeat) / bar);
    pos = a.firstBeat + Math.min(barsAfter, latestBar) * bar;
  }
  return pos;
}

/** Bar to start the transition at from the track's structure, or null to fall back to the outro. */
function structureMixOutBar(
  levels: number[],
  fullLevel: number | undefined,
  rule: MixOutRule,
  leadBars: number,
  earliestBar: number,
  latestBar: number,
): number | null {
  const found = drops(levels, fullLevel);
  if (found.length === 0) {
    // One long groove with no breakdown: leave on a phrase after the mood's maximum.
    const cap = Math.floor(rule.maxPlayBars / PHRASE_BARS) * PHRASE_BARS;
    return cap >= earliestBar && cap <= latestBar ? cap : null;
  }
  // Later drops are fallbacks when the track was started late.
  for (const drop of found.slice(Math.max(0, rule.mixOutAfterDrops - 1))) {
    if (drop.end >= levels.length) break; // the drop runs into the end: use the outro
    const start = Math.max(drop.start, drop.end - leadBars);
    if (start > latestBar) break;
    if (start >= earliestBar) return start;
  }
  return null;
}

export interface GridPosition {
  /** 0-based bar from the first downbeat (negative before it). */
  bar: number;
  /** Beat within the bar, 0–3. */
  beat: number;
  /** Progress through the current beat, 0..1. */
  phase: number;
}

/** Where a track position falls on the track's beat grid. */
export function gridPosition(a: TrackAnalysis, position: number): GridPosition {
  const beats = (position - a.firstBeat) / beatSeconds(a);
  const whole = Math.floor(beats);
  return {
    bar: Math.floor(whole / BEATS_PER_BAR),
    beat: ((whole % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR,
    phase: beats - whole,
  };
}

/** The first downbeat at or after `position` on the track's grid. */
export function nextDownbeat(a: TrackAnalysis, position: number): number {
  return nextBoundary(a, position, 1);
}

/** The first `bars`-bar boundary (counted from the first downbeat) at or after `position`. */
export function nextBoundary(a: TrackAnalysis, position: number, bars: number): number {
  const len = barSeconds(a) * bars;
  if (position <= a.firstBeat) return a.firstBeat;
  return a.firstBeat + Math.ceil((position - a.firstBeat) / len - 1e-9) * len;
}

/**
 * Bars of build-up before a Drop lands: the incoming track starts this many
 * (outgoing) bars before its drop and rises in underneath. At most `maxBars`,
 * no more than fit in `availableSec`, and no more than the incoming track has
 * before its drop cue when played at `rate`.
 */
export function dropBuildBars(availableSec: number, outBarSec: number, incomingCue: number, rate: number, maxBars: number): number {
  const byTime = Math.floor(availableSec / outBarSec + 1e-9);
  const byAudio = Math.floor(incomingCue / (outBarSec * rate) + 1e-9);
  return Math.max(0, Math.min(maxBars, byTime, byAudio));
}

/**
 * Where the incoming track starts when staff press Drop: its first drop (the
 * full section after its first breakdown), else the end of its intro, else its
 * first downbeat. Always on a downbeat of its grid.
 */
export function dropCue(a: TrackAnalysis): number {
  const bar = barSeconds(a);
  const first = a.barLevels ? drops(a.barLevels, a.fullLevel)[0] : undefined;
  if (first) return a.firstBeat + first.start * bar;
  const introBars = Math.floor((a.introEnd - a.firstBeat) / bar);
  return a.firstBeat + Math.max(0, introBars) * bar;
}
