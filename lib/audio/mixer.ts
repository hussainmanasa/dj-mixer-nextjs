// The staff mixer (owner decision: the booth's TRIM, EQ, CFX knobs, channel faders and crossfader work, like a
// DDJ-FLX4's): control positions → gains, EQ dB and filter settings. PURE.
//
// These sit on a separate stage after the auto-DJ's own automation (Deck.staff*), so the auto-DJ's beat-timed
// fades and EQ moves carry on underneath and staff settings simply add to them.

import { volumeGain } from "./volume";

/** One channel's controls. Knobs are −1 … +1 (0 = centre / neutral); the fader is 0 … 1 (1 = top). */
export interface MixerChannel {
  trim: number;
  hi: number;
  mid: number;
  low: number;
  /** Colour FX: −1 low-pass closed … 0 off … +1 high-pass fully up. */
  cfx: number;
  fader: number;
}

export const NEUTRAL_CHANNEL: MixerChannel = { trim: 0, hi: 0, mid: 0, low: 0, cfx: 0, fader: 1 };

/** TRIM range (dB either way), like the controller's. */
export const TRIM_DB = 12;
/** EQ range: a kill at full left (−26 dB, the DDJ-FLX4's), +6 dB at full right. */
export const EQ_MIN_DB = -26;
export const EQ_MAX_DB = 6;
/** The CFX filter's end points: the low-pass closes to this (Hz), the high-pass opens up to this. */
export const CFX_LOWPASS_MIN_HZ = 150;
export const CFX_HIGHPASS_MAX_HZ = 6000;
/** Around the centre the filter is off (the knob has a centre detent). */
const CFX_DEADZONE = 0.02;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export function trimDbOf(knob: number): number {
  return clamp(knob, -1, 1) * TRIM_DB;
}

export function eqDbOf(knob: number): number {
  const v = clamp(knob, -1, 1);
  return v < 0 ? -v * EQ_MIN_DB : v * EQ_MAX_DB;
}

/** Inverse of `eqDbOf`: where the knob points for a gain (dB) — used to show the auto-DJ's own EQ on the dial. */
export function eqKnobOf(db: number): number {
  return db >= 0 ? clamp(db / EQ_MAX_DB, 0, 1) : -clamp(db / EQ_MIN_DB, 0, 1);
}

/**
 * The CFX filter for a knob position: low-pass sweeping down from 20 kHz to 150 Hz to the left, high-pass sweeping
 * up from 20 Hz to 6 kHz to the right (exponential, so it sounds even), wide open in the centre.
 */
export function cfxFilterOf(knob: number): { type: "lowpass" | "highpass"; frequency: number; q: number } {
  const v = clamp(knob, -1, 1);
  if (Math.abs(v) < CFX_DEADZONE) return { type: "lowpass", frequency: 22050, q: 0.7 };
  const t = (Math.abs(v) - CFX_DEADZONE) / (1 - CFX_DEADZONE);
  // A little resonance as it closes, like a colour filter.
  const q = 0.7 + t * 1.8;
  if (v < 0) return { type: "lowpass", frequency: 20000 * Math.pow(CFX_LOWPASS_MIN_HZ / 20000, t), q };
  return { type: "highpass", frequency: 20 * Math.pow(CFX_HIGHPASS_MAX_HZ / 20, t), q };
}

/** Channel fader position → gain: the same squared taper as the volume (half way ≈ −12 dB). */
export function faderGainOf(fader: number): number {
  return volumeGain(fader);
}

/**
 * Crossfader position (0 = full left / channel 1, 1 = full right / channel 2) → the two channels' gains. A DJ
 * "sharp" curve: both full from the centre outwards until the far side starts to dip, so the centre leaves the
 * auto-DJ's mix untouched and either end cuts the other channel.
 */
export function crossfaderGains(x: number): [number, number] {
  const p = clamp(x, 0, 1);
  return [Math.min(1, 2 * (1 - p)), Math.min(1, 2 * p)];
}

/** The gain staff's fader and crossfader leave a channel at (0 = they've silenced it on purpose). */
export function channelGainOf(channel: MixerChannel, crossfader: number, side: 0 | 1 | null): number {
  const x = side === null ? 1 : crossfaderGains(crossfader)[side];
  return faderGainOf(channel.fader) * x;
}
