// Tests the key-lock AudioWorklet's DSP (public/worklets/keylock.js) in Node:
// the per-channel phase vocoder is plain JS, so we load it with stubs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEYLOCK_DELAY_SAMPLES } from "./keylock";

interface ChannelLike {
  step(x: number, pitch: number): number;
}
const code = readFileSync(join(__dirname, "../../public/worklets/keylock.js"), "utf8");
const { Channel, DELAY } = new Function(
  "AudioWorkletProcessor",
  "registerProcessor",
  `${code}\nreturn { Channel, DELAY };`,
)(class {}, () => {}) as { Channel: new () => ChannelLike; DELAY: number };

const SR = 44100;

function run(input: Float64Array, pitch: (i: number) => number): Float64Array {
  const ch = new Channel();
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = ch.step(input[i], pitch(i));
  return out;
}

function sine(freq: number, seconds: number, amp = 0.5): Float64Array {
  const x = new Float64Array(Math.floor(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

/** Frequency from upward zero crossings over [from, to). */
function frequency(x: Float64Array, from: number, to: number): number {
  const crossings: number[] = [];
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings.push(i - x[i] / (x[i] - x[i - 1]));
  return ((crossings.length - 1) * SR) / (crossings.at(-1)! - crossings[0]);
}

describe("key-lock worklet", () => {
  it("passes audio through unchanged (only delayed) at pitch 1", () => {
    const x = sine(440, 1);
    for (let i = 0; i < x.length; i++) x[i] += 0.2 * Math.sin((2 * Math.PI * 97 * i) / SR);
    const y = run(x, () => 1);
    let err = 0;
    for (let i = DELAY + 4096; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i - DELAY]));
    expect(err).toBeLessThan(1e-6);
    expect(DELAY).toBe(KEYLOCK_DELAY_SAMPLES);
  });

  it("undoes a 5% speed-up: 462 Hz in, 440 Hz out", () => {
    const y = run(sine(440 * 1.05, 2), () => 1 / 1.05);
    expect(frequency(y, SR / 2, 2 * SR - 1)).toBeCloseTo(440, 0);
  });

  it("undoes a 6% slow-down: 413.6 Hz in, 440 Hz out", () => {
    const y = run(sine(440 * 0.94, 2), () => 1 / 0.94);
    expect(frequency(y, SR / 2, 2 * SR - 1)).toBeCloseTo(440, 0);
  });

  it("keeps kicks within 5 ms of the fixed delay at any shift (no flamming between decks)", () => {
    // A click train: each output click's energy centre must sit ~DELAY after the input click.
    // Phase vocoders smear transients a little; under ~10 ms two decks' kicks don't flam.
    const x = new Float64Array(SR * 2);
    for (let c = SR / 4; c < x.length; c += SR / 4) for (let i = 0; i < 64; i++) x[c + i] = Math.sin((Math.PI * i) / 64);
    for (const rate of [1.08, 1.04, 0.96, 0.92]) {
      const y = run(x, () => 1 / rate);
      for (let c = SR / 2; c < SR * 1.5; c += SR / 4) {
        let sum = 0;
        let weighted = 0;
        for (let i = c + DELAY - 2048; i < c + DELAY + 2048; i++) {
          sum += y[i] * y[i];
          weighted += i * y[i] * y[i];
        }
        expect(Math.abs(weighted / sum - (c + 32 + DELAY))).toBeLessThan(0.005 * SR);
      }
    }
  });

  it("returns to pitch 1 without a click", () => {
    const x = sine(220, 3);
    // Shifted for 1.5 s, then exactly 1 (as when the tempo hand-back ends).
    const y = run(x, (i) => (i < 1.5 * SR ? 1 / 1.03 : 1));
    let maxStep = 0;
    for (let i = SR; i < 2.5 * SR; i++) maxStep = Math.max(maxStep, Math.abs(y[i] - y[i - 1]));
    // A 220 Hz sine at 0.5 moves at most ~0.016 per sample; a click would be far larger.
    expect(maxStep).toBeLessThan(0.05);
  });
});
