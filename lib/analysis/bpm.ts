// Pure tempo / beat-grid / energy analysis on mono PCM samples.
// No browser APIs: runs in the analysis Web Worker and in unit tests.
//
// Method (deliberately simple and dependency-free, MIT-friendly):
//   1. Onset envelope = positive change in log energy per hop, weighted towards
//      a low-passed (kick drum) band.
//   2. Tempo = autocorrelation peak of the envelope, folded into the DJ range
//      and refined by maximising a comb filter over the whole track.
//   3. Beat phase = comb offset with the highest summed onset strength;
//      downbeat = the beat (of 4) with the most low-band energy.

import type { TrackAnalysis } from "@/lib/types";

export const ANALYSIS_SAMPLE_RATE = 11025;
const HOP = 128; // ~11.6 ms at 11025 Hz
const WINDOW = 512;
const MIN_BPM = 85;
const MAX_BPM = 175;

export interface Envelopes {
  /** Onset strength per frame (full band + low band blend). */
  onset: Float32Array;
  /** Low-band (kick) energy per frame. */
  low: Float32Array;
  /** RMS per frame (full band). */
  rms: Float32Array;
  frameRate: number;
}

export function computeEnvelopes(samples: Float32Array, sampleRate: number): Envelopes {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const rms = new Float32Array(frames);
  const low = new Float32Array(frames);
  const onset = new Float32Array(frames);

  // One-pole low-pass at ~150 Hz isolates kick drums.
  const alpha = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const lowSignal = new Float32Array(samples.length);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += alpha * (samples[i] - y);
    lowSignal[i] = y;
  }

  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    let sum = 0;
    let lowSum = 0;
    for (let i = start; i < start + WINDOW; i++) {
      sum += samples[i] * samples[i];
      lowSum += lowSignal[i] * lowSignal[i];
    }
    rms[f] = Math.sqrt(sum / WINDOW);
    low[f] = Math.sqrt(lowSum / WINDOW);
  }

  const eps = 1e-6;
  for (let f = 1; f < frames; f++) {
    const full = Math.max(0, Math.log(rms[f] + eps) - Math.log(rms[f - 1] + eps));
    const kick = Math.max(0, Math.log(low[f] + eps) - Math.log(low[f - 1] + eps));
    onset[f] = 0.4 * full + 0.6 * kick;
  }
  // Remove slow trends so quiet passages still contribute.
  const smoothed = movingAverage(onset, 32);
  for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - smoothed[f]);

  return { onset, low, rms, frameRate: sampleRate / HOP };
}

function movingAverage(x: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(x.length);
  let acc = 0;
  let count = 0;
  for (let i = 0; i < Math.min(radius, x.length); i++) {
    acc += x[i];
    count++;
  }
  for (let i = 0; i < x.length; i++) {
    const add = i + radius;
    const drop = i - radius - 1;
    if (add < x.length) {
      acc += x[add];
      count++;
    }
    if (drop >= 0) {
      acc -= x[drop];
      count--;
    }
    out[i] = acc / count;
  }
  return out;
}

/** Linear-interpolated read of an envelope at a fractional frame index. */
function at(env: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= env.length) return 0;
  const t = pos - i;
  return env[i] * (1 - t) + env[i + 1] * t;
}

/** Sum of the envelope sampled every `period` frames starting at `phase`. */
function combScore(env: Float32Array, period: number, phase: number): number {
  let s = 0;
  for (let p = phase; p < env.length - 1; p += period) {
    // Take the max of a small neighbourhood to tolerate envelope smearing.
    s += Math.max(at(env, p - 1), at(env, p), at(env, p + 1));
  }
  return s;
}

function bestPhase(env: Float32Array, period: number): { phase: number; score: number; mean: number } {
  let best = 0;
  let bestScore = -Infinity;
  let total = 0;
  let n = 0;
  for (let phase = 0; phase < period; phase += 0.5) {
    const s = combScore(env, period, phase);
    total += s;
    n++;
    if (s > bestScore) {
      bestScore = s;
      best = phase;
    }
  }
  return { phase: best, score: bestScore, mean: total / Math.max(1, n) };
}

/** Coarse tempo from the autocorrelation of the onset envelope. */
export function coarseTempo(onset: Float32Array, frameRate: number): number {
  const minLag = Math.floor((60 * frameRate) / MAX_BPM);
  const maxLag = Math.ceil((60 * frameRate) / MIN_BPM);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    // Mild prior towards ~122 BPM (typical club tempo) to settle octave errors.
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 122) / 0.6, 2));
    const score = s * (0.7 + 0.3 * prior);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  return (60 * frameRate) / bestLag;
}

/** Refine a tempo estimate to 0.01 BPM by maximising the comb score. */
export function refineTempo(onset: Float32Array, frameRate: number, bpm: number): { bpm: number; phase: number; confidence: number } {
  let bestBpm = bpm;
  let best = { phase: 0, score: -Infinity, mean: 0 };
  const search = (from: number, to: number, step: number) => {
    for (let b = from; b <= to + 1e-9; b += step) {
      const r = bestPhase(onset, (60 * frameRate) / b);
      if (r.score > best.score) {
        best = r;
        bestBpm = b;
      }
    }
  };
  search(bpm * 0.97, bpm * 1.03, 0.1);
  const coarse = bestBpm;
  search(coarse - 0.1, coarse + 0.1, 0.01);
  // Peak-to-mean ratio of the phase search → 0..1 confidence.
  const ratio = best.mean > 0 ? best.score / best.mean : 1;
  const confidence = Math.max(0, Math.min(1, (ratio - 1) / 2));
  return { bpm: Math.round(bestBpm * 100) / 100, phase: best.phase, confidence };
}

/**
 * Fit the beat grid to actual onset peaks with weighted least squares.
 * The comb search lands within ~0.05 BPM; over a 6-minute track that still
 * drifts by a large fraction of a beat, so we regress peak positions on beat
 * index to get a drift-free period and phase.
 */
export function fitGrid(onset: Float32Array, period: number, phase: number): { period: number; phase: number } {
  let p = period;
  let ph = phase;
  for (let iter = 0; iter < 3; iter++) {
    const ks: number[] = [];
    const xs: number[] = [];
    const ws: number[] = [];
    const radius = p * 0.15;
    for (let k = 0; ph + k * p < onset.length - 2; k++) {
      const centre = ph + k * p;
      const lo = Math.max(1, Math.floor(centre - radius));
      const hi = Math.min(onset.length - 2, Math.ceil(centre + radius));
      let best = lo;
      for (let i = lo + 1; i <= hi; i++) if (onset[i] > onset[best]) best = i;
      const v = onset[best];
      if (v <= 0) continue;
      // Parabolic interpolation around the discrete peak.
      const a = onset[best - 1];
      const c = onset[best + 1];
      const denom = a - 2 * v + c;
      const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      ks.push(k);
      xs.push(best + Math.max(-0.5, Math.min(0.5, offset)));
      ws.push(v);
    }
    if (ks.length < 8) break;
    // Drop weak peaks (breakdowns) — keep the strongest 70%.
    const cutoff = [...ws].sort((x, y) => x - y)[Math.floor(ws.length * 0.3)];
    let sw = 0, sk = 0, sx = 0, skk = 0, skx = 0;
    for (let i = 0; i < ks.length; i++) {
      if (ws[i] < cutoff) continue;
      const w = ws[i];
      sw += w;
      sk += w * ks[i];
      sx += w * xs[i];
      skk += w * ks[i] * ks[i];
      skx += w * ks[i] * xs[i];
    }
    const det = sw * skk - sk * sk;
    if (det <= 0) break;
    const slope = (sw * skx - sk * sx) / det;
    const intercept = (sx - slope * sk) / sw;
    if (!(slope > period * 0.97 && slope < period * 1.03)) break;
    p = slope;
    ph = ((intercept % p) + p) % p;
  }
  return { period: p, phase: ph };
}

/** Choose which of the 4 beats in a bar is the downbeat (most kick energy). */
function downbeatOffset(low: Float32Array, period: number, phase: number): number {
  const sums = [0, 0, 0, 0];
  let k = 0;
  for (let p = phase; p < low.length - 1; p += period, k++) sums[k % 4] += at(low, p);
  let bestIdx = 0;
  for (let i = 1; i < 4; i++) if (sums[i] > sums[bestIdx] * 1.02) bestIdx = i;
  return bestIdx;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Full analysis of a mono signal. `tagBpm` (from file tags) is used when the
 * detector's confidence is low and the tag is plausible.
 */
export function analyzeSamples(samples: Float32Array, sampleRate: number, tagBpm: number | null = null): TrackAnalysis {
  const duration = samples.length / sampleRate;
  const env = computeEnvelopes(samples, sampleRate);
  const { onset, low, rms, frameRate } = env;

  let bpm = coarseTempo(onset, frameRate);
  while (bpm < MIN_BPM) bpm *= 2;
  while (bpm > MAX_BPM) bpm /= 2;
  let refined = refineTempo(onset, frameRate, bpm);

  if (tagBpm && tagBpm >= 60 && tagBpm <= 200 && refined.confidence < 0.25) {
    const fromTag = refineTempo(onset, frameRate, tagBpm);
    if (fromTag.confidence >= refined.confidence * 0.8) refined = fromTag;
  }

  const grid = fitGrid(onset, (60 * frameRate) / refined.bpm, refined.phase);
  const period = grid.period;
  refined = { ...refined, bpm: Math.round(((60 * frameRate) / period) * 1000) / 1000 };
  const beatIdx = downbeatOffset(low, period, grid.phase);
  // Frame f covers samples [f*HOP, f*HOP+WINDOW) and its energy rises once a
  // transient is well inside the window, so the onset frame lags the true
  // attack by ~3/4 of a window (measured on synthetic kicks).
  const latency = (0.75 * WINDOW) / sampleRate;
  const firstBeat = Math.max(0, (grid.phase + beatIdx * period) / frameRate + latency);

  // Energy: loudness (dBFS mapped −24..−8) blended with onset density.
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const db = 10 * Math.log10(sumSq / Math.max(1, samples.length) + 1e-12);
  const loud = Math.max(0, Math.min(1, (db + 24) / 16));
  let onsetSum = 0;
  for (let i = 0; i < onset.length; i++) onsetSum += onset[i];
  const density = Math.max(0, Math.min(1, (onsetSum / Math.max(1, onset.length)) * 12));
  const energy = Math.round((0.7 * loud + 0.3 * density) * 100) / 100;

  // Intro / outro from per-bar RMS.
  const barFrames = period * 4;
  const startFrame = firstBeat * frameRate;
  const barLevels: number[] = [];
  for (let b = startFrame; b + barFrames <= rms.length; b += barFrames) {
    let s = 0;
    let n = 0;
    for (let f = Math.floor(b); f < Math.floor(b + barFrames); f++, n++) s += rms[f];
    barLevels.push(s / Math.max(1, n));
  }
  const med = median(barLevels);
  const barSec = (60 / refined.bpm) * 4;
  let introBars = 0;
  while (introBars < barLevels.length && barLevels[introBars] < 0.8 * med) introBars++;
  let lastFull = barLevels.length - 1;
  while (lastFull > 0 && barLevels[lastFull] < 0.8 * med) lastFull--;
  const introEnd = Math.min(duration, firstBeat + introBars * barSec);
  const outroStart = Math.min(duration, firstBeat + (lastFull + 1) * barSec);

  return {
    bpm: refined.bpm,
    firstBeat: Math.round(firstBeat * 1000) / 1000,
    beatConfidence: Math.round(refined.confidence * 100) / 100,
    energy,
    duration: Math.round(duration * 1000) / 1000,
    introEnd: Math.round(introEnd * 1000) / 1000,
    outroStart: Math.round(outroStart * 1000) / 1000,
  };
}

/** Mix multi-channel PCM down to mono (in place into a new array). */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}
