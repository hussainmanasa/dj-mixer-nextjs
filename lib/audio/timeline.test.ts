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

  it("jumps from a dialogue straight to the drop", () => {
    // Dialogue from 1.2 s plays for 5 s, then the track continues from its drop at 128.5 s.
    const tl = new PlaybackTimeline(100, 1.2, 1, null, { at: 105, to: 128.5 });
    expect(tl.positionAt(104)).toBeCloseTo(5.2, 9);
    expect(tl.positionAt(105)).toBeCloseTo(128.5, 9);
    expect(tl.positionAt(115)).toBeCloseTo(138.5, 9);
    // Positions after the drop map to times after the jump; skipped ones to the jump itself.
    expect(tl.timeAt(138.5)).toBeCloseTo(115, 9);
    expect(tl.timeAt(3.2)).toBeCloseTo(102, 9);
    expect(tl.timeAt(60)).toBeCloseTo(105, 9);
  });

  it("keeps a later tempo ramp in step after the jump", () => {
    const tl = new PlaybackTimeline(0, 0, 1, { t0: 20, t1: 40, r0: 1, r1: 1.04 }, { at: 10, to: 50 });
    expect(tl.positionAt(20)).toBeCloseTo(60, 9);
    expect(tl.positionAt(40)).toBeCloseTo(60 + 20.4, 9);
    for (const t of [12, 20, 33, 40, 55]) expect(tl.timeAt(tl.positionAt(t))).toBeCloseTo(t, 6);
  });
});
