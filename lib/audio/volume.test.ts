import { describe, expect, it } from "vitest";
import { volumeGain } from "./volume";

describe("volumeGain", () => {
  it("is full level at 100%, silent at 0 and about −12 dB in the middle", () => {
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0)).toBe(0);
    expect(20 * Math.log10(volumeGain(0.5))).toBeCloseTo(-12, 0);
  });

  it("never boosts and treats bad values safely", () => {
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
    expect(volumeGain(NaN)).toBe(1);
  });

  it("gets louder as the slider goes up", () => {
    for (let v = 0; v < 1; v += 0.1) expect(volumeGain(v + 0.1)).toBeGreaterThan(volumeGain(v));
  });
});
