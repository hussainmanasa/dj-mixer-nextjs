import { describe, expect, it } from "vitest";
import { computeWaveform } from "./waveform";

const SR = 11025;
const tone = (hz: number, seconds: number, amp = 0.8) =>
  Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

describe("computeWaveform", () => {
  it("has 100 bins a second, scaled so the loud peaks reach the top", () => {
    const w = computeWaveform([tone(60, 2)], SR);
    expect(w.rate).toBe(100);
    expect(w.peak.length).toBe(200);
    expect(Math.max(...w.peak)).toBe(255);
  });

  it("shows a bass tone as bass and a high tone as not", () => {
    const bass = computeWaveform([tone(55, 1)], SR);
    const high = computeWaveform([tone(3000, 1)], SR);
    const mean = (a: Uint8Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(bass.low) / mean(bass.peak)).toBeGreaterThan(0.8);
    expect(mean(high.low) / mean(high.peak)).toBeLessThan(0.1);
  });

  it("follows the music: silence reads as zero, a hit as a peak", () => {
    const s = new Float32Array(SR);
    s.set(tone(60, 0.1), Math.round(SR * 0.5));
    const w = computeWaveform([s, s], SR);
    expect(w.peak[10]).toBe(0);
    expect(Math.max(...w.peak.slice(50, 60))).toBe(255);
  });
});
