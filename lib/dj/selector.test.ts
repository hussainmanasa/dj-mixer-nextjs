import { describe, expect, it } from "vitest";
import type { Track, TrackAnalysis } from "@/lib/types";
import { getMood } from "./moods";
import { chooseTransition, isMoodJump, pickNext, rankCandidates, type SelectionContext } from "./selector";
import { mixOutPoint, nextDownbeat } from "./mixpoints";

function track(id: string, bpm: number, energy: number, extra: Partial<Track> = {}, a: Partial<TrackAnalysis> = {}): Track {
  return {
    id,
    path: `${id}.mp3`,
    title: id,
    artist: extra.artist ?? `artist-${id}`,
    genres: [],
    camelot: null,
    tagBpm: null,
    status: "ready",
    addedAt: 0,
    analysis: {
      bpm,
      firstBeat: 0.5,
      beatConfidence: 0.8,
      energy,
      duration: 360,
      introEnd: 30,
      outroStart: 330,
      ...a,
    },
    ...extra,
  };
}

function ctx(partial: Partial<SelectionContext> = {}): SelectionContext {
  return {
    mood: getMood("groove"),
    current: null,
    currentBpm: null,
    targetEnergy: 0.6,
    history: [],
    recentArtists: [],
    jump: false,
    ...partial,
  };
}

describe("pickNext", () => {
  it("prefers tracks close to the current tempo", () => {
    const current = track("cur", 122, 0.6);
    const lib = [track("near", 123, 0.6), track("far", 135, 0.6)];
    expect(pickNext(lib, ctx({ current, currentBpm: 122 }))?.id).toBe("near");
  });

  it("prefers harmonically compatible keys when tempo and energy tie", () => {
    const current = track("cur", 122, 0.6, { camelot: "8A" });
    const lib = [track("clash", 122, 0.6, { camelot: "3B" }), track("match", 122, 0.6, { camelot: "9A" })];
    expect(pickNext(lib, ctx({ current, currentBpm: 122 }))?.id).toBe("match");
  });

  it("never repeats recently played tracks or the current track", () => {
    const current = track("cur", 122, 0.6);
    const lib = [current, track("played", 122, 0.6), track("fresh", 126, 0.5)];
    expect(pickNext(lib, ctx({ current, currentBpm: 122, history: ["played"] }))?.id).toBe("fresh");
  });

  it("penalises the same artist back to back", () => {
    const current = track("cur", 122, 0.6, { artist: "DJ A" });
    const lib = [track("same", 122, 0.6, { artist: "DJ A" }), track("other", 122.5, 0.6, { artist: "DJ B" })];
    expect(pickNext(lib, ctx({ current, currentBpm: 122, recentArtists: ["DJ A"] }))?.id).toBe("other");
  });

  it("skips tracks that are not analysed yet", () => {
    const lib = [track("pending", 122, 0.6, { status: "pending" }), track("ready", 122, 0.6)];
    expect(pickNext(lib, ctx())?.id).toBe("ready");
  });

  it("on a mood jump scores tempo against the new mood, not the current track", () => {
    const current = track("cur", 128, 0.9);
    const chill = getMood("chill");
    const lib = [track("fast", 128, 0.3), track("slow", 105, 0.3)];
    const c = ctx({ mood: chill, current, currentBpm: 128, targetEnergy: 0.3, jump: true });
    expect(rankCandidates(lib, c)[0].track.id).toBe("slow");
  });
});

describe("chooseTransition", () => {
  it("blends compatible, close-tempo tracks", () => {
    expect(chooseTransition(track("a", 124, 0.6), track("b", 125, 0.6), 124, false)).toBe("blend");
  });
  it("echoes out across big tempo changes", () => {
    expect(chooseTransition(track("a", 128, 0.6), track("b", 105, 0.6), 128, false)).toBe("echoOut");
  });
  it("cuts when a beat grid is unreliable", () => {
    expect(chooseTransition(track("a", 124, 0.6), track("b", 124, 0.6, {}, { beatConfidence: 0.1 }), 124, false)).toBe("cut");
  });
  it("filter-sweeps across clashing keys", () => {
    expect(
      chooseTransition(track("a", 124, 0.6, { camelot: "8A" }), track("b", 124, 0.6, { camelot: "3B" }), 124, false),
    ).toBe("filterSweep");
  });
});

describe("isMoodJump", () => {
  it("detects far tempo bands", () => {
    expect(isMoodJump(128, getMood("chill"))).toBe(true);
    expect(isMoodJump(120, getMood("groove"))).toBe(false);
    expect(isMoodJump(null, getMood("chill"))).toBe(false);
  });
});

describe("mix points", () => {
  const a: TrackAnalysis = { bpm: 120, firstBeat: 0.5, beatConfidence: 0.9, energy: 0.6, duration: 360, introEnd: 16.5, outroStart: 330.5 };
  it("aligns the mix-out to an 8-bar phrase and leaves room for the blend", () => {
    const pos = mixOutPoint(a, 16);
    const bars = (pos - a.firstBeat) / 2; // 2 s per bar at 120 BPM
    expect(bars % 8).toBe(0);
    expect(pos + 16 * 2).toBeLessThanOrEqual(a.duration);
  });
  it("never returns a point before notBefore", () => {
    expect(mixOutPoint(a, 16, 300)).toBeGreaterThanOrEqual(300);
  });
  it("finds the next downbeat", () => {
    expect(nextDownbeat(a, 0)).toBe(0.5);
    expect(nextDownbeat(a, 3)).toBe(4.5);
  });
});
