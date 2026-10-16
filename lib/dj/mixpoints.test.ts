import { describe, expect, it } from "vitest";
import type { TrackAnalysis } from "@/lib/types";
import { dropBuildBars, dropCue, gridPosition, mixOutFor, mixOutPoint, nextBoundary, type MixOutRule } from "./mixpoints";

function bars(...runs: [number, number][]): number[] {
  return runs.flatMap(([n, level]) => Array<number>(n).fill(level));
}

// 120 BPM → 2 s per bar; the grid starts at 0.5 s.
const BAR = 2;
function track(levels: number[]): TrackAnalysis {
  return {
    bpm: 120,
    firstBeat: 0.5,
    beatConfidence: 0.9,
    energy: 0.7,
    duration: 0.5 + levels.length * BAR,
    introEnd: 0.5,
    outroStart: 0.5 + levels.length * BAR,
    barLevels: levels,
    version: 2,
  };
}
const barOf = (pos: number) => (pos - 0.5) / BAR;

const oneDrop: MixOutRule = { mixOutAfterDrops: 1, maxPlayBars: 96 };
const twoDrops: MixOutRule = { mixOutAfterDrops: 2, maxPlayBars: 96 };

// intro+groove 48 · breakdown 16 · drop 32 (64–96) · breakdown 16 · drop 32 (112–144) · outro 32
const clubTrack = track(bars([48, 1], [16, 0.1], [32, 1], [16, 0.1], [32, 1], [32, 0.15]));

describe("mixOutPoint with track structure", () => {
  it("leaves after the main drop, with the bass swap where the track breaks down", () => {
    // 16-bar blend → swap 8 bars in → start 8 bars before the breakdown at bar 96.
    expect(barOf(mixOutPoint(clubTrack, 16, 0, oneDrop, 8))).toBe(88);
  });

  it("plays through a second drop when the mood asks for it", () => {
    expect(barOf(mixOutPoint(clubTrack, 16, 0, twoDrops, 8))).toBe(136);
  });

  it("starts an echo-out right as the track breaks down", () => {
    expect(barOf(mixOutPoint(clubTrack, 8, 0, oneDrop, 0))).toBe(96);
  });

  it("is much earlier than the old play-to-the-outro behaviour", () => {
    expect(barOf(mixOutPoint(clubTrack, 16, 0, oneDrop, 8))).toBeLessThan(barOf(mixOutPoint(clubTrack, 16)));
  });

  it("moves on to the next drop when the track started too late for the first", () => {
    const notBefore = 0.5 + 90 * BAR;
    expect(barOf(mixOutPoint(clubTrack, 16, notBefore, oneDrop, 8))).toBe(136);
  });

  it("never starts the blend before the drop itself", () => {
    const shortDrop = track(bars([48, 1], [16, 0.1], [8, 1], [16, 0.1], [32, 1], [16, 0.2]));
    expect(barOf(mixOutPoint(shortDrop, 32, 0, oneDrop, 16))).toBe(64);
  });

  it("caps a track that never breaks down at the mood's maximum", () => {
    const groove = track(bars([200, 0.9]));
    expect(barOf(mixOutPoint(groove, 16, 0, oneDrop, 8))).toBe(96);
  });

  it("falls back to the outro when the track has fewer drops than the mood wants", () => {
    const single = track(bars([48, 1], [16, 0.1], [64, 1], [32, 0.2]));
    const rule: MixOutRule = { mixOutAfterDrops: 2, maxPlayBars: 96 };
    expect(mixOutPoint(single, 16, 0, rule, 8)).toBe(mixOutPoint(single, 16));
  });

  it("keeps the old behaviour for tracks analysed before bar levels existed", () => {
    const old = { ...clubTrack, barLevels: undefined, version: undefined };
    expect(mixOutPoint(old, 16, 0, oneDrop, 8)).toBe(mixOutPoint(old, 16));
  });
});

describe("gridPosition", () => {
  // 120 BPM: 0.5 s per beat, first downbeat at 0.5 s.
  const a = track(bars([8, 1]));
  it("finds the bar, beat and progress through the beat", () => {
    expect(gridPosition(a, 0.5)).toEqual({ bar: 0, beat: 0, phase: 0 });
    expect(gridPosition(a, 0.5 + 4 * 2 + 3 * 0.5 + 0.25)).toEqual({ bar: 4, beat: 3, phase: 0.5 });
  });
  it("is negative before the first downbeat", () => {
    expect(gridPosition(a, 0.25)).toEqual({ bar: -1, beat: 3, phase: 0.5 });
  });
});

describe("Drop button cue points", () => {
  it("lands on the next 4-bar boundary", () => {
    // 4 bars = 8 s at 120 BPM.
    expect(barOf(nextBoundary(clubTrack, 0.5 + 9 * BAR, 4))).toBe(12);
    expect(barOf(nextBoundary(clubTrack, 0.5 + 12 * BAR, 4))).toBe(12);
  });

  it("starts the incoming track on its first drop", () => {
    expect(barOf(dropCue(clubTrack))).toBe(64);
  });

  it("falls back to the end of the intro, then the first downbeat", () => {
    const noDrops = { ...track(bars([128, 0.9])), introEnd: 0.5 + 16.4 * BAR };
    expect(barOf(dropCue(noDrops))).toBe(16);
    const old = { ...clubTrack, barLevels: undefined, introEnd: 0.2 };
    expect(dropCue(old)).toBe(0.5);
  });
});

describe("dropBuildBars", () => {
  // 2 s bars on the outgoing deck.
  it("uses as many bars as fit before the drop lands, up to the maximum", () => {
    expect(dropBuildBars(9.9, 2, 60, 1, 8)).toBe(4);
    expect(dropBuildBars(30, 2, 60, 1, 8)).toBe(8);
  });
  it("never starts the incoming track before its beginning", () => {
    // Its drop is 5 s in at rate 1 → only 2 whole bars of build.
    expect(dropBuildBars(30, 2, 5, 1, 8)).toBe(2);
    expect(dropBuildBars(30, 2, 0, 1, 8)).toBe(0);
  });
});

describe("mixOutFor (cue out)", () => {
  it("starts the transition so its hand-over lands on the cue out", () => {
    // A 16-bar blend hands over halfway (8 bars in): cue out at bar 100 → start at bar 92.
    const cueOut = 0.5 + 100 * BAR;
    expect(barOf(mixOutFor(clubTrack, cueOut, 16, 0, oneDrop))).toBe(92);
    // An echo-out or cut hands over at once.
    expect(barOf(mixOutFor(clubTrack, cueOut, 8, 0, oneDrop, 0))).toBe(100);
  });

  it("falls back to the song's own mix-out point without a cue out, or once it has passed", () => {
    expect(mixOutFor(clubTrack, undefined, 16, 0, oneDrop)).toBe(mixOutPoint(clubTrack, 16, 0, oneDrop));
    const cueOut = 0.5 + 20 * BAR;
    expect(mixOutFor(clubTrack, cueOut, 16, 0.5 + 30 * BAR, oneDrop)).toBe(mixOutPoint(clubTrack, 16, 0.5 + 30 * BAR, oneDrop));
  });
});
