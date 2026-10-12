// Where to start and end transitions on a track's beat grid. Pure functions.

import type { TrackAnalysis } from "@/lib/types";

export const BEATS_PER_BAR = 4;
/** Phrases in dance music are usually 8 or 16 bars; we align mix-outs to 8. */
export const PHRASE_BARS = 8;

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
 * Picks the last phrase boundary (multiple of 8 bars from the first downbeat)
 * at or before the outro, keeping at least `blendBars` + 1 bars of audio after
 * it. Never returns a point earlier than `notBefore`.
 */
export function mixOutPoint(a: TrackAnalysis, blendBars: number, notBefore = 0): number {
  const bar = barSeconds(a);
  const totalBars = Math.floor((a.duration - a.firstBeat) / bar);
  const latestBar = totalBars - blendBars - 1;
  if (latestBar <= 0) return Math.max(notBefore, a.firstBeat);

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

/** The first downbeat at or after `position` on the track's grid. */
export function nextDownbeat(a: TrackAnalysis, position: number): number {
  const bar = barSeconds(a);
  if (position <= a.firstBeat) return a.firstBeat;
  return a.firstBeat + Math.ceil((position - a.firstBeat) / bar) * bar;
}
