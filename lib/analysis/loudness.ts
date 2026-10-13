// Integrated loudness, after ITU-R BS.1770: K-weighting, 400 ms blocks with
// 75% overlap, absolute (−70) and relative (−10 LU) gating. PURE.
//
// Runs on the analysis signal (mono downmix at 11 025 Hz), so the value is on
// our own scale rather than true LUFS — fine, it is only used to match tracks
// against each other (see `trimDb`).

/** Fallback target when no track has a loudness yet (on the analysis scale). */
export const TARGET_LOUDNESS = -10;
/** Trims stay within this range: quiet tracks get at most +6 dB (the limiter catches peaks). */
export const MAX_CUT_DB = -12;
export const MAX_BOOST_DB = 6;

/**
 * The library's typical loudness (median): every track is matched to it, so
 * the typical track plays unchanged and only quiet or loud outliers move.
 * Matching to a fixed level instead would push a whole quiet library to the
 * boost cap and leave its differences uncorrected.
 */
export function libraryLoudness(values: (number | undefined)[]): number {
  const v = values.filter((x): x is number => x !== undefined && x > -70).sort((a, b) => a - b);
  if (v.length === 0) return TARGET_LOUDNESS;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Gain (dB) that brings a track of `loudness` to `target`; 0 when unknown. */
export function trimDb(loudness: number | undefined, target = TARGET_LOUDNESS): number {
  if (loudness === undefined || loudness <= -70) return 0;
  return Math.round(Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, target - loudness)) * 10) / 10;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** BS.1770 stage 1: high shelf, +4 dB above ~1.7 kHz (head effect). */
function shelf(fs: number): Biquad {
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

/** BS.1770 stage 2: high-pass at ~38 Hz. */
function highpass(fs: number): Biquad {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / fs);
  const a0 = 1 + K / Q + K * K;
  return { b0: 1 / a0, b1: -2 / a0, b2: 1 / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare + 1e-12);

/** Integrated loudness of a mono signal; −70 for silence. */
export function integratedLoudness(samples: Float32Array, sampleRate: number): number {
  const k = filter(filter(samples, shelf(sampleRate)), highpass(sampleRate));
  const block = Math.floor(0.4 * sampleRate);
  const hop = Math.floor(block / 4);
  const powers: number[] = [];
  for (let s = 0; s + block <= k.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += k[i] * k[i];
    powers.push(sum / block);
  }
  const absolute = powers.filter((p) => toLufs(p) > -70);
  if (absolute.length === 0) return -70;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const relativeGate = toLufs(mean(absolute)) - 10;
  const gated = absolute.filter((p) => toLufs(p) > relativeGate);
  return Math.round(toLufs(mean(gated.length ? gated : absolute)) * 10) / 10;
}
