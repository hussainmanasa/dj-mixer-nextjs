// The detailed waveform the booth scrolls past its playhead: per 10 ms bin, the
// loudest sample and the loudest bass (below ~200 Hz), so kicks and basslines
// stand out from hats and vocals. PURE: runs in the waveform worker.

export interface Waveform {
  /** Bins per second of track. */
  rate: number;
  /** Loudest sample in each bin, 0..255 (255 = the track's loud peaks). */
  peak: Uint8Array;
  /** Loudest bass in each bin, 0..255 on the same scale. */
  low: Uint8Array;
}

export const WAVEFORM_RATE = 100;
/** One-pole low-pass for the bass band. */
const LOW_HZ = 200;

/** A waveform from (any number of) channels at `sampleRate`, mixed to mono. */
export function computeWaveform(channels: Float32Array[], sampleRate: number, rate = WAVEFORM_RATE): Waveform {
  const n = channels[0]?.length ?? 0;
  const per = sampleRate / rate;
  const bins = Math.ceil(n / per);
  const peak = new Float32Array(bins);
  const low = new Float32Array(bins);
  const a = 1 - Math.exp((-2 * Math.PI * LOW_HZ) / sampleRate);
  const gain = 1 / Math.max(1, channels.length);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const ch of channels) x += ch[i];
    x *= gain;
    lp += a * (x - lp);
    const b = Math.floor(i / per);
    const ax = Math.abs(x);
    if (ax > peak[b]) peak[b] = ax;
    const al = Math.abs(lp);
    if (al > low[b]) low[b] = al;
  }
  // Scale to the track's loud peaks (99th percentile), so quiet masters still fill the view.
  const sorted = Float32Array.from(peak).sort();
  const ref = sorted[Math.floor(sorted.length * 0.99)] || 1;
  const toByte = (v: number) => Math.min(255, Math.round((v / ref) * 255));
  return { rate, peak: Uint8Array.from(peak, toByte), low: Uint8Array.from(low, toByte) };
}
