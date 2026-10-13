import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { duplicateCounts, trackIssues } from "./issues";

function t(id: string, extra: Partial<Track> = {}, a: Partial<NonNullable<Track["analysis"]>> = {}): Track {
  return {
    id,
    path: `${id}.mp3`,
    title: "Song",
    artist: "Artist",
    genres: [],
    camelot: "8A",
    tagBpm: null,
    status: "ready",
    addedAt: 0,
    analysis: { bpm: 124, firstBeat: 0, beatConfidence: 0.8, energy: 0.6, duration: 300, introEnd: 0, outroStart: 300, loudness: -10, ...a },
    ...extra,
  };
}

const kinds = (track: Track, all: Track[] = [track]) => trackIssues(track, duplicateCounts(all), -10).map((i) => i.kind);

describe("trackIssues", () => {
  it("passes a healthy track", () => {
    expect(kinds(t("ok"))).toEqual([]);
  });
  it("flags shaky grids, missing keys, extreme levels and short files", () => {
    expect(kinds(t("a", { camelot: null }, { beatConfidence: 0.1, loudness: -40, duration: 60 }))).toEqual(["grid", "level", "short", "noKey"]);
  });
  it("flags tracks with no drops found", () => {
    expect(kinds(t("a", {}, { barLevels: Array(150).fill(0.9) }))).toEqual(["noDrops"]);
  });
  it("spots duplicates despite case, punctuation and mix suffixes", () => {
    const a = t("a", { title: "Night Drive (Extended Mix)" });
    const b = t("b", { title: "night drive" });
    expect(kinds(a, [a, b])).toEqual(["duplicate"]);
  });
  it("reports failed files", () => {
    expect(kinds(t("x", { status: "error", analysis: null, camelot: null, error: "Bad file" }))).toEqual(["failed"]);
  });
});
