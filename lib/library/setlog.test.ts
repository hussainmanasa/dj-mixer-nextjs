import { describe, expect, it } from "vitest";
import type { SetLogEntry } from "@/lib/types";
import { groupNights, nightOf, toCsv } from "./setlog";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
function entry(time: number, title: string, extra: Partial<SetLogEntry> = {}): SetLogEntry {
  return { at: time, trackId: title, title, artist: "Artist", path: `${title}.mp3`, mood: "peak", how: "blend", requested: false, bpm: 128, key: "8A", duration: 360, ...extra };
}

describe("set log", () => {
  it("puts after-midnight tracks in the previous evening's night", () => {
    expect(nightOf(at(2026, 10, 14, 2))).toBe("2026-10-13");
    expect(nightOf(at(2026, 10, 14, 7))).toBe("2026-10-14");
  });

  it("groups nights newest first and works out how long each track played", () => {
    const nights = groupNights([
      entry(at(2026, 10, 13, 23, 0), "A", { how: "start" }),
      entry(at(2026, 10, 13, 23, 3), "B"),
      entry(at(2026, 10, 14, 1, 0), "C"), // after a stop: capped at its length
      entry(at(2026, 10, 15, 22, 0), "D"),
    ]);
    expect(nights.map((n) => n.night)).toEqual(["2026-10-15", "2026-10-13"]);
    expect(nights[1].entries.map((e) => e.playedSec)).toEqual([180, 360, 360]);
    expect(nights[0].entries[0].playedSec).toBeNull();
  });

  it("exports CSV with quoting for commas and quotes", () => {
    const csv = toCsv(groupNights([entry(at(2026, 10, 13, 23), 'Song, "Remix"', { artist: "A & B", requested: true })]));
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe("Night,Started,Played (s),Title,Artist,File,Mood,Came in by,Requested,BPM,Key");
    expect(row).toBe('2026-10-13,2026-10-13 23:00:00,,"Song, ""Remix""",A & B,"Song, ""Remix"".mp3",peak,Blend,yes,128.0,8A');
  });
});
