import { describe, expect, it } from "vitest";
import { PlaybackTimeline } from "./timeline";

describe("PlaybackTimeline", () => {
  it("maps time ↔ position at a constant rate", () => {
    const tl = new PlaybackTimeline(10, 2, 1.05);
    expect(tl.positionAt(10)).toBe(2);
    expect(tl.positionAt(20)).toBeCloseTo(12.5, 9);
    expect(tl.timeAt(12.5)).toBeCloseTo(20, 9);
  });

  it("integrates a linear rate ramp and inverts it", () => {
    const tl = new PlaybackTimeline(0, 0, 1.06, { t0: 30, t1: 60, r0: 1.06, r1: 1 });
    // Before the ramp
    expect(tl.positionAt(30)).toBeCloseTo(31.8, 9);
    // Through the ramp: average rate 1.03 over 30 s
    expect(tl.positionAt(60)).toBeCloseTo(31.8 + 30.9, 9);
    // After the ramp at rate 1
    expect(tl.positionAt(70)).toBeCloseTo(31.8 + 30.9 + 10, 9);
    for (const t of [5, 30, 41.3, 59.9, 60, 88]) {
      expect(tl.timeAt(tl.positionAt(t))).toBeCloseTo(t, 6);
    }
    expect(tl.rateAt(45)).toBeCloseTo(1.03, 9);
  });
});
