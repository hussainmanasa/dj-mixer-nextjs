import { describe, expect, it } from "vitest";
import { drops, sections } from "./structure";

/** Bar levels from [bars, level] runs. */
function bars(...runs: [number, number][]): number[] {
  return runs.flatMap(([n, level]) => Array<number>(n).fill(level));
}

describe("sections", () => {
  it("splits a club track into full and quiet sections", () => {
    const levels = bars([16, 0.45], [32, 1], [16, 0.1], [32, 1], [16, 0.2]);
    expect(sections(levels)).toEqual([
      { start: 0, end: 48, full: true },
      { start: 48, end: 64, full: false },
      { start: 64, end: 96, full: true },
      { start: 96, end: 112, full: false },
    ]);
  });

  it("ignores one-bar fills and short teases", () => {
    const levels = bars([30, 1], [1, 0.1], [1, 1], [12, 0.1], [2, 0.9], [2, 0.1], [32, 1]);
    expect(sections(levels)).toEqual([
      { start: 0, end: 32, full: true },
      { start: 32, end: 48, full: false },
      { start: 48, end: 80, full: true },
    ]);
  });
});

describe("drops", () => {
  it("finds the full sections that return after a breakdown", () => {
    const levels = bars([32, 1], [16, 0.1], [32, 1], [16, 0.1], [32, 1], [16, 0.15]);
    expect(drops(levels).map((d) => [d.start, d.end])).toEqual([
      [48, 80],
      [96, 128],
    ]);
  });

  it("counts a kick-only intro as music, so the first drop after the breakdown is found", () => {
    // Kick-only intro (0.45) · breakdown · drop.
    expect(drops(bars([16, 0.45], [8, 0.1], [16, 1], [8, 0.1], [16, 1])).map((d) => d.start)).toEqual([24, 48]);
  });

  it("does not count a quiet intro building into the beat as a drop", () => {
    expect(drops(bars([16, 0.1], [64, 1], [16, 0.2]))).toEqual([]);
  });

  it("finds nothing in a track that never breaks down", () => {
    expect(drops(bars([128, 0.9]))).toEqual([]);
    expect(drops([])).toEqual([]);
  });
});
