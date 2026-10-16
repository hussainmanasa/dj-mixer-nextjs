import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { DEFAULT_SETTINGS } from "./store";
import { applySettingsFile, buildSettingsFile, contentKey, parseSettingsFile } from "./settingsFile";

const t = (id: string, path: string, extra: Partial<Track> = {}): Track =>
  ({ id, path, title: path, artist: "", genres: [], camelot: null, tagBpm: null, analysis: null, status: "ready", addedAt: 0, ...extra }) as Track;

const library = {
  a: t("a", "Bollywood/a.mp3", { flag: "favourite", crates: ["Romantic"], cues: { start: 12, end: 180 }, savedLoops: [{ start: 10, end: 17.6 }] }),
  b: t("b", "Punjabi/b.mp3"),
  s: t("s", "session:x.wav", { flag: "ban" }),
};
const settings = { ...DEFAULT_SETTINGS, deckCount: 3, volume: 0.6, mainOutput: "speaker-id", previewOutput: "phones-id" };

describe("settings file", () => {
  it("holds the portable settings and the edited songs only (no devices, no session files)", () => {
    const f = buildSettingsFile(settings, library, 1000);
    expect(f.settings).toEqual({ deckCount: 3, keyLock: false, moods: {}, volume: 0.6, previewVolume: 1 });
    expect(Object.keys(f.tracks)).toEqual(["a"]);
    expect(f.tracks.a).toMatchObject({ path: "Bollywood/a.mp3", flag: "favourite", crates: ["Romantic"], cues: { start: 12, end: 180 } });
    expect(JSON.stringify(f)).not.toContain("speaker-id");
  });

  it("reads back what it wrote, and refuses files that aren't ours", () => {
    const f = buildSettingsFile(settings, library, 1000);
    const back = parseSettingsFile(JSON.stringify(f))!;
    expect(contentKey(back)).toBe(contentKey(f));
    expect(back.savedAt).toBe(1000);
    expect(parseSettingsFile("{ nope")).toBeNull();
    expect(parseSettingsFile(JSON.stringify({ app: "other", version: 1 }))).toBeNull();
  });

  it("keeps only sensible values from a hand-edited file", () => {
    const f = parseSettingsFile(
      JSON.stringify({
        app: "ai-dj-mixer",
        version: 1,
        savedAt: 5,
        settings: { deckCount: 9, volume: 2, keyLock: true },
        tracks: { a: { path: "x.mp3", flag: "weird", cues: { start: -3, end: 20 }, hotCues: [1, "no"], savedLoops: [{ start: 5, end: 2 }] } },
      }),
    )!;
    expect(f.settings).toEqual({ keyLock: true });
    expect(f.tracks.a).toEqual({ path: "x.mp3", title: "x.mp3", cues: { end: 20 }, hotCues: [1, null], savedLoops: [] });
  });

  it("applies edits by content id, else by path, and reports only songs that changed", () => {
    const file = buildSettingsFile(settings, library, 1000);
    // Another computer: the same songs without edits; one file was re-encoded (new id) but sits at the same path.
    const other = { a2: t("a2", "Bollywood/a.mp3"), b: t("b", "Punjabi/b.mp3") };
    const changed = applySettingsFile(file, other);
    expect(Object.keys(changed)).toEqual(["a2"]);
    expect(changed.a2).toMatchObject({ flag: "favourite", crates: ["Romantic"], cues: { start: 12, end: 180 }, savedLoops: [{ start: 10, end: 17.6 }] });
    expect(applySettingsFile(file, { a: library.a })).toEqual({});
  });
});
