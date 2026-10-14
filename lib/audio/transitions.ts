// Transition recipes: Web Audio automation applied to an outgoing and an
// incoming deck. Each function schedules everything in advance from context
// time `t` (when the incoming track starts) and returns when the transition
// is over, so the caller can hand over control.

import type { TransitionKind } from "@/lib/types";
import { Deck, EQ_KILL_DB, REWIND_SECONDS } from "./deck";

export interface TransitionPlan {
  kind: TransitionKind;
  /** Context time the incoming deck starts. */
  start: number;
  /** Context time the outgoing deck is silent and can be stopped. */
  end: number;
  /** Drop transitions: context time the incoming track's drop hits. */
  drop?: number;
}

/**
 * Long beat-matched blend with a bass swap halfway:
 *   bars 0..½  incoming fades in with its bass killed
 *   at ½       basslines swap in one beat (never two kicks at once)
 *   bars ½..1  outgoing fades out with its bass killed
 */
export function blend(out: Deck, inc: Deck, t: number, bars: number, beatSec: number): TransitionPlan {
  const len = bars * 4 * beatSec;
  const mid = t + len / 2;

  inc.resetControls(0);
  inc.low.gain.setValueAtTime(EQ_KILL_DB, t);
  inc.fader.gain.setValueAtTime(0, t);
  inc.fader.gain.linearRampToValueAtTime(1, mid);
  inc.low.gain.setValueAtTime(EQ_KILL_DB, mid - beatSec);
  inc.low.gain.linearRampToValueAtTime(0, mid);

  out.low.gain.setValueAtTime(0, mid - beatSec);
  out.low.gain.linearRampToValueAtTime(EQ_KILL_DB, mid);
  out.fader.gain.setValueAtTime(1, mid);
  out.fader.gain.linearRampToValueAtTime(0, t + len);

  return { kind: "blend", start: t, end: t + len };
}

/**
 * Beat-matched filter sweep (8 bars): outgoing is high-passed away while the
 * incoming opens up from a low-pass. Hides key clashes better than a blend.
 */
export function filterSweep(out: Deck, inc: Deck, t: number, beatSec: number): TransitionPlan {
  const len = 8 * 4 * beatSec;
  const end = t + len;

  // Switch filter types now at inaudible cut-offs; the sweeps are scheduled.
  out.filter.type = "highpass";
  out.filter.frequency.cancelScheduledValues(0);
  out.filter.frequency.setValueAtTime(10, 0);
  out.filter.frequency.setValueAtTime(10, t);
  out.filter.frequency.exponentialRampToValueAtTime(2500, end);
  out.fader.gain.setValueAtTime(1, t + len * 0.6);
  out.fader.gain.linearRampToValueAtTime(0, end);

  inc.resetControls(0);
  inc.filter.type = "lowpass";
  inc.filter.frequency.setValueAtTime(300, t);
  inc.filter.frequency.exponentialRampToValueAtTime(20000, end);
  inc.fader.gain.setValueAtTime(0, t);
  inc.fader.gain.linearRampToValueAtTime(1, t + len * 0.4);

  return { kind: "filterSweep", start: t, end };
}

/**
 * Echo-out for tempo jumps (no beat-matching): the outgoing track's last beat
 * rings out through a dotted-eighth delay while its dry signal drops, then the
 * incoming track starts clean two beats later at its own tempo.
 */
export function echoOut(out: Deck, inc: Deck, t: number, outBeatSec: number): TransitionPlan {
  const tail = 8;
  out.echoDelay.delayTime.setValueAtTime(Math.min(4, outBeatSec * 0.75), t);
  out.echoSend.gain.setValueAtTime(0, t);
  out.echoSend.gain.linearRampToValueAtTime(0.7, t + outBeatSec);
  out.fader.gain.setValueAtTime(1, t + outBeatSec);
  out.fader.gain.linearRampToValueAtTime(0, t + outBeatSec * 1.5);
  out.echoSend.gain.setValueAtTime(0.7, t + outBeatSec * 1.5);
  out.echoSend.gain.linearRampToValueAtTime(0, t + outBeatSec * 2);

  const incStart = t + outBeatSec * 2;
  inc.resetControls(0);
  inc.fader.gain.setValueAtTime(1, incStart);

  return { kind: "echoOut", start: incStart, end: incStart + tail };
}

/** Bars the outgoing track keeps fading after a drop lands. */
export const DROP_FADE_BARS = 2;

/**
 * Drop swap (staff pressed Drop). The incoming deck starts at `start`, some
 * bars before its own drop, beat-matched so that drop lands on `t`:
 *   build   incoming rises under a falling high-pass with its bass killed;
 *           the outgoing track eases down to 70% under a rising high-pass
 *   t       the incoming bass and full range hit together
 *   fade    the outgoing track keeps playing in time and fades out over
 *           DROP_FADE_BARS, its high-pass rising so its kick and bass never
 *           double the new drop
 * With no build (`start === t`: tempos too far apart to sync, or an
 * unreliable grid) overlapping would clash, so it is a clean cut onto the
 * drop with an echo tail instead.
 */
export function dropIn(out: Deck, inc: Deck, start: number, t: number, outBeatSec: number): TransitionPlan {
  const build = t - start > 0.05;
  const fadeEnd = t + DROP_FADE_BARS * 4 * outBeatSec;
  if (build) {
    // Switch the filter type now at an inaudible cut-off; the sweep is scheduled.
    out.filter.type = "highpass";
    out.filter.frequency.cancelScheduledValues(0);
    out.filter.frequency.setValueAtTime(10, 0);
    out.filter.frequency.setValueAtTime(10, start);
    out.filter.frequency.exponentialRampToValueAtTime(350, t);
    out.filter.frequency.exponentialRampToValueAtTime(2000, fadeEnd);
    out.fader.gain.setValueAtTime(1, start);
    out.fader.gain.linearRampToValueAtTime(0.7, t);
    out.fader.gain.linearRampToValueAtTime(0, fadeEnd);
  } else {
    out.echoDelay.delayTime.setValueAtTime(Math.min(4, outBeatSec * 0.75), t - outBeatSec);
    out.echoSend.gain.setValueAtTime(0, t - outBeatSec);
    out.echoSend.gain.linearRampToValueAtTime(0.6, t - 0.01);
    out.echoSend.gain.linearRampToValueAtTime(0, t + 0.02);
    out.fader.gain.setValueAtTime(1, t - 0.01);
    out.fader.gain.linearRampToValueAtTime(0, t + 0.02);
  }

  inc.resetControls(0);
  if (build) {
    inc.filter.type = "highpass";
    inc.filter.frequency.setValueAtTime(700, start);
    inc.filter.frequency.exponentialRampToValueAtTime(120, t - 0.01);
    inc.low.gain.setValueAtTime(EQ_KILL_DB, start);
    inc.fader.gain.setValueAtTime(0, start);
    inc.fader.gain.linearRampToValueAtTime(0.75, t - 0.01);
  } else {
    inc.fader.gain.setValueAtTime(0, t - 0.01);
  }
  // On the drop: full range, bass and level in together (short ramps, no clicks).
  inc.filter.frequency.setValueAtTime(10, t);
  inc.low.gain.setValueAtTime(build ? EQ_KILL_DB : 0, t - 0.01);
  inc.low.gain.linearRampToValueAtTime(0, t + 0.01);
  inc.fader.gain.linearRampToValueAtTime(1, t + 0.02);

  // Faded: hand over once the outgoing deck is silent. Cut: after one bar, once the echo tail is in the delay line.
  return { kind: "drop", start, end: build ? fadeEnd : t + 4 * outBeatSec, drop: t };
}

/**
 * Dialogue → drop (Desi Night, or a Drop onto a song with a marked dialogue):
 * the outgoing track's last beat goes into the echo and it cuts out at `t`,
 * when the incoming deck starts its dialogue — clear, at full level, with the
 * echo tail fading underneath. The incoming deck itself jumps from the end of
 * the dialogue to its drop (`Deck.start` with a jump at `drop`).
 */
export function dialogueIn(out: Deck, inc: Deck, t: number, drop: number, outBeatSec: number): TransitionPlan {
  out.echoDelay.delayTime.setValueAtTime(Math.min(4, outBeatSec * 0.75), t - outBeatSec);
  out.echoSend.gain.setValueAtTime(0, t - outBeatSec);
  // Quieter than an echo-out's throw, so the tail sits under the words.
  out.echoSend.gain.linearRampToValueAtTime(0.4, t - 0.01);
  out.echoSend.gain.linearRampToValueAtTime(0, t + 0.02);
  out.fader.gain.setValueAtTime(1, t - 0.01);
  out.fader.gain.linearRampToValueAtTime(0, t + 0.02);

  inc.resetControls(0);
  inc.fader.gain.setValueAtTime(0, t - 0.01);
  inc.fader.gain.linearRampToValueAtTime(1, t + 0.02);

  // Hand over once the outgoing deck is out (the incoming deck jumps by itself).
  return { kind: "dialogue", start: t, end: t + 4 * outBeatSec, drop };
}

/** Seconds a rewind takes before the next track (or its dialogue) comes in. */
export const REWIND_LEAD = REWIND_SECONDS;

/**
 * Rewind (spinback) for big tempo jumps in moods with `rewind`: at `t` the
 * outgoing track is cut and spins back (`Deck.rewind`); REWIND_LEAD later the
 * incoming deck comes in at full level — on its drop, or on a dialogue that
 * then drops (`kind` "dialogue", `drop` when it lands).
 */
export function rewindInto(out: Deck, inc: Deck, t: number, kind: "rewind" | "dialogue" = "rewind", drop?: number): TransitionPlan {
  out.fader.gain.setValueAtTime(1, t - 0.01);
  out.fader.gain.linearRampToValueAtTime(0, t + 0.02);
  out.rewind(t);
  const start = t + REWIND_LEAD;
  inc.resetControls(0);
  inc.fader.gain.setValueAtTime(0, start - 0.01);
  inc.fader.gain.linearRampToValueAtTime(1, start + 0.01);
  return { kind, start, end: start + 0.1, drop: drop ?? start };
}

/** Hard cut on a downbeat — the fallback when a beat grid can't be trusted. */
export function cut(out: Deck, inc: Deck, t: number): TransitionPlan {
  out.fader.gain.setValueAtTime(1, t - 0.01);
  out.fader.gain.linearRampToValueAtTime(0, t + 0.02);
  inc.resetControls(0);
  inc.fader.gain.setValueAtTime(0, t - 0.01);
  inc.fader.gain.linearRampToValueAtTime(1, t + 0.02);
  return { kind: "cut", start: t, end: t + 0.05 };
}
