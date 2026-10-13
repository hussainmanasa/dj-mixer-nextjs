import { describe, expect, it } from "vitest";
import { fft } from "./fft";
import { detectKey } from "./keydetect";
import { integratedLoudness, libraryLoudness, TARGET_LOUDNESS, trimDb } from "./loudness";

const SR = 11025;

function tone(freqs: number[], seconds: number, amp = 0.2): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (const f of freqs) for (let h = 1; h <= 3; h++) v += Math.sin((2 * Math.PI * f * h * i) / SR) / h;
    out[i] = (amp * v) / freqs.length;
  }
  return out;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** Chords as MIDI notes, each held for `seconds`. */
function progression(chords: number[][], seconds: number): Float32Array {
  const parts = chords.map((c) => tone(c.map(hz), seconds));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("fft", () => {
  it("finds a pure tone in the right bin", () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(37);
  });
});

describe("integratedLoudness", () => {
  it("tracks level: 6 dB quieter reads ~6 LU lower", () => {
    const loud = integratedLoudness(tone([440], 10, 0.4), SR);
    const quiet = integratedLoudness(tone([440], 10, 0.2), SR);
    expect(loud - quiet).toBeGreaterThan(5.8);
    expect(loud - quiet).toBeLessThan(6.2);
  });
  it("ignores silence (gating)", () => {
    const music = tone([440], 10, 0.4);
    const withSilence = new Float32Array(music.length * 2);
    withSilence.set(music);
    expect(Math.abs(integratedLoudness(withSilence, SR) - integratedLoudness(music, SR))).toBeLessThan(0.3);
  });
  it("reports −70 for silence", () => {
    expect(integratedLoudness(new Float32Array(SR * 5), SR)).toBe(-70);
  });
});

describe("trimDb", () => {
  it("brings tracks to the target, within limits", () => {
    expect(trimDb(TARGET_LOUDNESS)).toBe(0);
    expect(trimDb(TARGET_LOUDNESS + 4)).toBe(-4);
    expect(trimDb(TARGET_LOUDNESS - 3)).toBe(3);
    expect(trimDb(TARGET_LOUDNESS - 20)).toBe(6);
    expect(trimDb(TARGET_LOUDNESS + 30)).toBe(-12);
  });
  it("leaves unknown or silent tracks alone", () => {
    expect(trimDb(undefined)).toBe(0);
    expect(trimDb(-70)).toBe(0);
  });
  it("matches tracks to the library's typical loudness", () => {
    const target = libraryLoudness([-20, -26, -19, -21, undefined, -70]);
    expect(target).toBe(-20.5);
    expect(trimDb(-20.5, target)).toBe(0);
    expect(trimDb(-26, target)).toBe(5.5);
    expect(libraryLoudness([])).toBe(TARGET_LOUDNESS);
  });
});

describe("detectKey", () => {
  it("hears A minor (i–iv–v–i)", () => {
    // Am, Dm, Em, Am
    const k = detectKey(progression([[57, 60, 64], [62, 65, 69], [64, 67, 71], [57, 60, 64]], 3), SR);
    expect(k?.camelot).toBe("8A");
  });
  it("hears C major (I–IV–V–I)", () => {
    const k = detectKey(progression([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]], 3), SR);
    expect(k?.camelot).toBe("8B");
  });
  it("hears G major", () => {
    const k = detectKey(progression([[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]], 3), SR);
    expect(k?.camelot).toBe("9B");
  });
  it("returns null for silence", () => {
    expect(detectKey(new Float32Array(SR * 3), SR)).toBeNull();
  });
});
