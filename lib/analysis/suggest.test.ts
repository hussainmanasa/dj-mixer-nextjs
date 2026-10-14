import { describe, expect, it } from "vitest";
import { ANALYSIS_SAMPLE_RATE as SR } from "./bpm";
import { barChroma, suggestDialogue, suggestHook } from "./suggest";

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A chord (MIDI notes) with a few harmonics, `seconds` long, into `out` at `at`. */
function chord(out: Float32Array, at: number, seconds: number, notes: number[], amp: number) {
  const i0 = Math.floor(at * SR);
  const n = Math.floor(seconds * SR);
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    let v = 0;
    for (const m of notes) for (let h = 1; h <= 3; h++) v += Math.sin((2 * Math.PI * hz(m) * h * i) / SR) / h;
    out[i0 + i] += (amp * v) / notes.length;
  }
}

/** Kick on every beat (with a bass note between) from `from` to `to` seconds. */
function beat(out: Float32Array, bpm: number, from: number, to: number) {
  const beatSec = 60 / bpm;
  for (let t = from; t < to; t += beatSec) {
    const i0 = Math.floor(t * SR);
    for (let i = 0; i < 0.18 * SR && i0 + i < out.length; i++) {
      const s = i / SR;
      out[i0 + i] += 0.6 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-s * 35)) * s) * Math.exp(-s * 14);
    }
  }
}

/** Speech-like: syllables of a voiced harmonic sound at irregular lengths and gaps. */
function speech(out: Float32Array, from: number, to: number) {
  let t = from;
  while (t < to) {
    const len = 0.08 + rnd() * 0.18;
    const f0 = 180 + rnd() * 60;
    const i0 = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    for (let i = 0; i < n && i0 + i < out.length; i++) {
      const envelope = Math.sin((Math.PI * i) / n);
      let v = 0;
      for (let h = 1; h <= 14; h++) v += Math.sin((2 * Math.PI * f0 * h * i) / SR) * (h < 5 ? 1 : 0.4) / h;
      out[i0 + i] += 0.3 * envelope * v;
    }
    t += len + 0.04 + rnd() * 0.22;
  }
}

describe("suggestHook", () => {
  it("finds the repeated chorus, at its first occurrence", () => {
    // 100 BPM → 2.4 s bars. Verse A · chorus · verse B · chorus · verse C · chorus, 8 bars each.
    const bpm = 100;
    const bar = 2.4;
    const chorus = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [57, 60, 64]];
    const verse = (shift: number) => [[62 + shift, 65 + shift, 69 + shift], [64 + shift, 67 + shift, 71 + shift], [59 + shift, 62 + shift, 66 + shift], [61 + shift, 65 + shift, 68 + shift]];
    const plan = [verse(0), chorus, verse(1), chorus, verse(3), chorus];
    const out = new Float32Array(Math.ceil(plan.length * 8 * bar * SR) + SR);
    const loudness: number[] = [];
    plan.forEach((prog, s) => {
      for (let b = 0; b < 8; b++) {
        const loud = prog === chorus ? 0.5 : 0.3;
        chord(out, (s * 8 + b) * bar, bar, prog[b % 4], loud);
        loudness.push(prog === chorus ? 1 : 0.6);
      }
    });
    const grid = { bpm, firstBeat: 0 };
    const hook = suggestHook(barChroma(out, SR, grid, loudness.length), loudness, grid);
    expect(hook).not.toBeNull();
    expect(hook!.start).toBeCloseTo(8 * bar, 1);
    expect(hook!.end - hook!.start).toBeCloseTo(8 * bar, 1);
    expect(hook!.confidence).toBeGreaterThan(0.2);
  });

  it("suggests nothing for a song that never repeats", () => {
    const out = new Float32Array(SR * 80);
    const levels: number[] = [];
    for (let b = 0; b < 32; b++) {
      // A random chord every bar: nothing repeats.
      const root = 48 + Math.floor(rnd() * 24);
      chord(out, b * 2.4, 2.4, [root, root + 3 + Math.floor(rnd() * 2), root + 7 + Math.floor(rnd() * 3)], 0.3);
      levels.push(0.5);
    }
    const grid = { bpm: 100, firstBeat: 0 };
    expect(suggestHook(barChroma(out, SR, grid, 32), levels, grid)).toBeNull();
  });
});

describe("suggestDialogue", () => {
  const bpm = 120;

  it("finds speech before the beat kicks in", () => {
    // Speech 0.5–5.5 s, then kick + bass from 6 s (bar 3 at 2 s bars).
    const out = new Float32Array(SR * 30);
    speech(out, 0.5, 5.5);
    beat(out, bpm, 6, 30);
    const d = suggestDialogue(out, SR, { bpm, firstBeat: 0 });
    expect(d).not.toBeNull();
    expect(d!.start).toBeGreaterThan(0.1);
    expect(d!.start).toBeLessThan(1);
    expect(d!.end).toBeGreaterThan(5);
    expect(d!.end).toBeLessThan(6.6);
    expect(d!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("doesn't mistake a kick-and-hats intro or a pad breakdown for dialogue", () => {
    const out = new Float32Array(SR * 40);
    beat(out, bpm, 0, 16);
    // Hats on the off-beats throughout, a steady pad from 16 s.
    for (let t = 0.25; t < 40; t += 0.5) {
      const i0 = Math.floor(t * SR);
      for (let i = 0; i < 0.03 * SR; i++) out[i0 + i] += 0.08 * (rnd() * 2 - 1) * Math.exp(-(i / SR) * 110);
    }
    chord(out, 16, 24, [57, 60, 64], 0.2);
    expect(suggestDialogue(out, SR, { bpm, firstBeat: 0 })).toBeNull();
  });
});
