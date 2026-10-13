import { describe, expect, it } from "vitest";
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION, analyzeSamples } from "./bpm";
import { drops } from "./structure";

/**
 * Synthetic four-on-the-floor loop: kick on every beat, accented downbeat, hats off-beat.
 * Bars in `breakdowns` ([from, to) bar ranges) keep the hats but drop the kick.
 */
function synthTrack(
  bpm: number,
  seconds: number,
  firstBeat: number,
  sr = ANALYSIS_SAMPLE_RATE,
  breakdowns: [number, number][] = [],
): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sr));
  const beat = 60 / bpm;
  let rnd = 1;
  const noise = () => {
    rnd = (rnd * 16807) % 2147483647;
    return rnd / 2147483647 - 0.5;
  };
  for (let k = 0; firstBeat + k * beat < seconds; k++) {
    const t0 = Math.floor((firstBeat + k * beat) * sr);
    const accent = k % 4 === 0 ? 1 : 0.6;
    const bar = Math.floor(k / 4);
    const kick = breakdowns.some(([from, to]) => bar >= from && bar < to) ? 0 : 1;
    for (let i = 0; i < 0.15 * sr && t0 + i < out.length; i++) {
      const t = i / sr;
      out[t0 + i] += kick * accent * 0.8 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-t * 40)) * t) * Math.exp(-t * 18);
    }
    const h0 = Math.floor((firstBeat + (k + 0.5) * beat) * sr);
    for (let i = 0; i < 0.03 * sr && h0 + i < out.length; i++) out[h0 + i] += 0.15 * noise() * Math.exp(-(i / sr) * 120);
  }
  return out;
}

describe("analyzeSamples", () => {
  for (const bpm of [100, 123.45, 128, 140]) {
    it(`detects ${bpm} BPM`, () => {
      const result = analyzeSamples(synthTrack(bpm, 60, 0.5), ANALYSIS_SAMPLE_RATE);
      expect(Math.abs(result.bpm - bpm)).toBeLessThan(0.02);
    });
  }

  it("keeps the grid locked over a 5-minute track (no drift)", () => {
    const bpm = 124.3;
    const result = analyzeSamples(synthTrack(bpm, 300, 0.4), ANALYSIS_SAMPLE_RATE);
    const n = Math.floor(280 / (60 / bpm));
    const predicted = result.firstBeat + n * (60 / result.bpm);
    const actual = 0.4 + n * (60 / bpm);
    // Downbeat may be a whole bar off; compare modulo one bar.
    const bar = (60 / bpm) * 4;
    const err = Math.abs(((predicted - actual + bar / 2) % bar + bar) % bar - bar / 2);
    expect(err).toBeLessThan(0.015);
  });

  it("places the beat grid on the accented downbeat", () => {
    const bpm = 126;
    const result = analyzeSamples(synthTrack(bpm, 60, 0.7), ANALYSIS_SAMPLE_RATE);
    const bar = (60 / bpm) * 4;
    // First downbeat at 0.7s (or a whole bar later); allow 15 ms tolerance.
    const err = Math.abs(((result.firstBeat - 0.7 + bar / 2) % bar) - bar / 2);
    expect(err).toBeLessThan(0.015);
    expect(result.beatConfidence).toBeGreaterThan(0.3);
  });

  it("reports duration and an energy value in range", () => {
    const result = analyzeSamples(synthTrack(128, 30, 0), ANALYSIS_SAMPLE_RATE);
    expect(result.duration).toBeCloseTo(30, 1);
    expect(result.energy).toBeGreaterThanOrEqual(0);
    expect(result.energy).toBeLessThanOrEqual(1);
  });

  it("finds the drops after kick-less breakdowns", () => {
    const bpm = 128;
    const bar = (60 / bpm) * 4;
    const samples = synthTrack(bpm, 0.5 + 112 * bar, 0.5, ANALYSIS_SAMPLE_RATE, [
      [32, 48],
      [80, 96],
    ]);
    const result = analyzeSamples(samples, ANALYSIS_SAMPLE_RATE);
    const found = drops(result.barLevels ?? []);
    expect(found).toHaveLength(2);
    // Sections land on the right bars (±1 if the downbeat was placed a bar late).
    expect(Math.abs(found[0].start - 48)).toBeLessThanOrEqual(1);
    expect(Math.abs(found[0].end - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(found[1].start - 96)).toBeLessThanOrEqual(1);
    expect(result.version).toBe(ANALYSIS_VERSION);
    expect(result.loudness).toBeGreaterThan(-40);
  });

  it("uses an admin-corrected grid instead of detecting one", () => {
    const result = analyzeSamples(synthTrack(128, 60, 0.5), ANALYSIS_SAMPLE_RATE, null, { bpm: 64, firstBeat: 1.2 });
    expect(result.bpm).toBe(64);
    expect(result.firstBeat).toBe(1.2);
    expect(result.beatConfidence).toBe(1);
    // Bars are counted on the corrected grid: 3.75 s each at 64 BPM.
    expect(result.barLevels?.length).toBe(Math.floor((60 - 1.2) / 3.75));
  });
});
