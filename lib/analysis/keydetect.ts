// Musical key from audio: a chromagram (energy per pitch class) correlated
// with the Krumhansl–Kessler key profiles. PURE — runs in the analysis worker.
// Used only when a file has no key tag.

import { fft, hann } from "./fft";
import { toCamelot } from "./key";

const FRAME = 4096;
const MIN_HZ = 55; // A1
const MAX_HZ = 2000;
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Krumhansl & Kessler (1982) probe-tone profiles, tonic first.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface DetectedKey {
  /** Camelot notation, e.g. "8A". */
  camelot: string;
  /** Margin of the best key over the runner-up, 0..1. Below ~0.05 is a guess. */
  confidence: number;
}

/** Summed energy per pitch class (C = 0) over the whole signal. */
export function chromagram(samples: Float32Array, sampleRate: number): Float64Array {
  const chroma = new Float64Array(12);
  const win = hann(FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const binPc: number[] = [];
  for (let k = 0; k < FRAME / 2; k++) {
    const f = (k * sampleRate) / FRAME;
    binPc.push(f < MIN_HZ || f > MAX_HZ ? -1 : (((Math.round(12 * Math.log2(f / 440)) + 9) % 12) + 12) % 12);
  }
  for (let s = 0; s + FRAME <= samples.length; s += FRAME / 2) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const frame = new Float64Array(12);
    for (let k = 1; k < FRAME / 2; k++) {
      const pc = binPc[k];
      if (pc >= 0) frame[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    // Normalise per frame so loud sections don't dominate the key.
    const total = frame.reduce((a, b) => a + b, 0);
    if (total > 1e-6) for (let pc = 0; pc < 12; pc++) chroma[pc] += frame[pc] / total;
  }
  return chroma;
}

function correlation(x: ArrayLike<number>, y: number[], shift: number): number {
  let mx = 0, my = 0;
  for (let i = 0; i < 12; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= 12;
  my /= 12;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < 12; i++) {
    const dx = x[(i + shift) % 12] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy + 1e-12);
}

/** Best-matching key of a chromagram, or null for silence / no tonal content. */
export function keyFromChroma(chroma: ArrayLike<number>): DetectedKey | null {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum <= 1e-9) return null;
  const scores: { name: string; r: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    scores.push({ name: `${NOTES[tonic]} major`, r: correlation(chroma, MAJOR, tonic) });
    scores.push({ name: `${NOTES[tonic]} minor`, r: correlation(chroma, MINOR, tonic) });
  }
  scores.sort((a, b) => b.r - a.r);
  const camelot = toCamelot(scores[0].name);
  if (!camelot) return null;
  return { camelot, confidence: Math.round(Math.max(0, Math.min(1, scores[0].r - scores[1].r)) * 100) / 100 };
}

export function detectKey(samples: Float32Array, sampleRate: number): DetectedKey | null {
  return keyFromChroma(chromagram(samples, sampleRate));
}
