// Suggested song markers — the hook (chorus) and a dialogue — for the admin to
// confirm in the track editor. PURE: runs in the analysis worker.
//
// These are heuristics. The auto-DJ never uses a suggestion until the admin
// accepts it as a marker.

import { fft, hann } from "./fft";
import { chromaFrames } from "./keydetect";
import type { SuggestedRange } from "@/lib/types";

export type Suggestion = SuggestedRange;

export interface Grid {
  bpm: number;
  firstBeat: number;
}

/** Hook lengths tried, in bars. */
const HOOK_LENGTHS = [16, 8];

/**
 * Harmony of each bar from the first downbeat: average chroma, mean-removed
 * and unit length, so the dot product of two bars is their correlation
 * (−1..1). Silent bars are all zero.
 */
export function barChroma(samples: Float32Array, sampleRate: number, grid: Grid, bars: number): Float64Array[] {
  const barSec = 240 / grid.bpm;
  const sums = Array.from({ length: bars }, () => new Float64Array(12));
  for (const f of chromaFrames(samples, sampleRate)) {
    const b = Math.floor((f.time - grid.firstBeat) / barSec);
    if (b >= 0 && b < bars) for (let pc = 0; pc < 12; pc++) sums[b][pc] += f.chroma[pc];
  }
  return sums.map((v) => {
    const mean = v.reduce((a, b) => a + b, 0) / 12;
    const c = v.map((x) => x - mean);
    const norm = Math.sqrt(c.reduce((a, b) => a + b * b, 0));
    return norm > 1e-9 ? c.map((x) => x / norm) : new Float64Array(12);
  });
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[i] * b[i];
  return s;
}

/**
 * The hook: the 16- or 8-bar stretch whose harmony repeats most closely
 * somewhere else in the song, favouring louder stretches. Choruses repeat;
 * verses vary. Returns its first occurrence (on a downbeat).
 * `loudness` is 0..1 per bar.
 */
export function suggestHook(chroma: Float64Array[], loudness: number[], grid: Grid): Suggestion | null {
  const n = chroma.length;
  const barSec = 240 / grid.bpm;
  const scores: number[] = [];
  let best: { i: number; L: number; score: number; rep: number } | null = null;
  for (const L of HOOK_LENGTHS) {
    if (n < 2 * L) continue;
    // Every bar: the grid's first downbeat is the earliest one in the file (often inside an
    // intro), so sections needn't start on a multiple of 4 bars from it.
    for (let i = 0; i + L <= n; i++) {
      let rep = 0;
      for (let j = 0; j + L <= n; j++) {
        if (Math.abs(j - i) < L) continue;
        let s = 0;
        for (let k = 0; k < L; k++) s += dot(chroma[i + k], chroma[j + k]);
        rep = Math.max(rep, s / L);
      }
      let loud = 0;
      for (let k = 0; k < L; k++) loud += loudness[i + k] ?? 0;
      // A slight preference for a full 16-bar hook over half of one.
      const score = rep * rep * (0.6 + 0.4 * (loud / L)) * (L === 16 ? 1.05 : 1);
      scores.push(score);
      // Earlier occurrences win near-ties (the first chorus).
      if (!best || score > best.score * 1.02) best = { i, L, score, rep };
    }
  }
  if (!best || best.rep < 0.6) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const start = grid.firstBeat + best.i * barSec;
  return {
    start: round(start),
    end: round(start + best.L * barSec),
    confidence: round(Math.max(0, Math.min(1, (best.score - median) / best.score)), 2),
  };
}

const FFT_SIZE = 1024;
const HOP = 256;
/** Analysis window and hop for the speech test, in seconds. */
const WIN_SEC = 1;
const WIN_HOP_SEC = 0.25;
const MIN_DIALOGUE_SEC = 1.5;

/**
 * A dialogue: speech-like stretches of at least 1.5 s — energy in the voice
 * band, no kick or bassline, pulsing at syllable rate but not on the beat —
 * preferring one that ends just before the music kicks in (where DJ edits put
 * their dialogue): the kick / bass band jumps up within 8 s after it.
 */
export function suggestDialogue(samples: Float32Array, sampleRate: number, grid: Grid): Suggestion | null {
  const frames = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
  if (frames < 10) return null;
  const win = hann(FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const binHz = sampleRate / FFT_SIZE;
  const low = new Float64Array(frames);
  const voice = new Float64Array(frames);
  const total = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[f * HOP + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const e = re[k] * re[k] + im[k] * im[k];
      const hz = k * binHz;
      total[f] += e;
      if (hz < 120) low[f] += e;
      else if (hz >= 150 && hz <= 3400) voice[f] += e;
    }
  }
  const frameSec = HOP / sampleRate;
  const winFrames = Math.round(WIN_SEC / frameSec);
  const winHop = Math.round(WIN_HOP_SEC / frameSec);
  const loudest = [...total].sort((a, b) => a - b)[Math.floor(frames * 0.95)] || 1;
  const beatFrames = 60 / grid.bpm / frameSec;
  const env = Array.from(voice, Math.sqrt);

  const speech: boolean[] = [];
  for (let w = 0; w + winFrames <= frames; w += winHop) {
    let t = 0, l = 0, v = 0, mean = 0;
    for (let f = w; f < w + winFrames; f++) {
      t += total[f];
      l += low[f];
      v += voice[f];
      mean += env[f];
    }
    mean /= winFrames;
    let variance = 0;
    for (let f = w; f < w + winFrames; f++) variance += (env[f] - mean) ** 2;
    const cv = mean > 0 ? Math.sqrt(variance / winFrames) / mean : 0;
    // Music pulses on the beat (hats, kicks); speech doesn't.
    const periodic = Math.max(autocorr(env, w, winFrames, mean, beatFrames), autocorr(env, w, winFrames, mean, beatFrames / 2));
    speech.push(t / winFrames > loudest * 1e-3 && v / t >= 0.6 && l / t <= 0.1 && cv >= 0.5 && periodic < 0.4);
  }

  // Merge speech windows into runs of at least MIN_DIALOGUE_SEC.
  const runs: { start: number; end: number }[] = [];
  speech.forEach((on, i) => {
    if (!on) return;
    const start = i * winHop * frameSec;
    const end = start + WIN_SEC;
    const last = runs[runs.length - 1];
    if (last && start <= last.end) last.end = end;
    else runs.push({ start, end });
  });
  const long = runs.filter((r) => r.end - r.start >= MIN_DIALOGUE_SEC);
  if (long.length === 0) return null;

  // Does the beat come in right after it? The kick / bass band (< 120 Hz) jumps well above
  // its level during the run within 8 s. (Measured directly: a voice's low notes can make
  // the per-bar bass levels read the dialogue itself as "full".)
  const lowMean = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from / frameSec));
    const b = Math.min(frames, Math.ceil(to / frameSec));
    let sum = 0;
    for (let f = a; f < b; f++) sum += low[f];
    return b > a ? sum / (b - a) : 0;
  };
  const loudestLow = [...low].sort((x, y) => x - y)[Math.floor(frames * 0.95)] || 1;
  const leadsIn = (r: { start: number; end: number }) => {
    const during = lowMean(r.start, r.end);
    for (let t = r.end - 1; t < r.end + 8; t += 0.25) {
      if (lowMean(t, t + 0.5) >= Math.max(10 * during, 0.05 * loudestLow)) return true;
    }
    return false;
  };
  const pick = long.find(leadsIn) ?? long[0];
  // Windows are 1 s long: trim the run to where the voice actually starts and stops.
  const f0 = Math.floor(pick.start / frameSec);
  const f1 = Math.min(frames - 1, Math.ceil(pick.end / frameSec));
  let peak = 0;
  for (let f = f0; f <= f1; f++) peak = Math.max(peak, env[f]);
  let first = f0;
  let last = f1;
  while (first < f1 && env[first] < peak * 0.15) first++;
  while (last > first && env[last] < peak * 0.15) last--;
  return {
    start: round(Math.max(0, first * frameSec - 0.1)),
    end: round((last * HOP + FFT_SIZE) / sampleRate + 0.1),
    confidence: leadsIn(pick) ? 0.7 : 0.4,
  };
}

/** Normalised autocorrelation of env[w..w+n) at a (fractional) lag. */
function autocorr(env: number[], w: number, n: number, mean: number, lag: number): number {
  const L = Math.round(lag);
  if (L < 1 || L >= n) return 0;
  let num = 0, den = 0;
  for (let f = w; f < w + n; f++) {
    const a = env[f] - mean;
    den += a * a;
    if (f + L < w + n) num += a * (env[f + L] - mean);
  }
  return den > 0 ? num / den : 0;
}

function round(x: number, digits = 3): number {
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}
