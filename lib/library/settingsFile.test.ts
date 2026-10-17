import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { DEFAULT_SETTINGS } from "./store";
import { ANALYSIS_VERSION } from "@/lib/analysis/bpm";
import type { TrackAnalysis } from "@/lib/types";
import { analysesFor, applySettingsFile, buildSettingsFile, contentKey, parseSettingsFile } from "./settingsFile";

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

  describe("analysis", () => {
    const analysis: TrackAnalysis = {
      bpm: 126,
      firstBeat: 0.31,
      beatConfidence: 0.8,
      energy: 0.7,
      duration: 180,
      introEnd: 15,
      outroStart: 165,
      barLevels: [0.123456, 1, 0.5],
      version: ANALYSIS_VERSION,
      loudness: -9.5,
      detectedKey: "8A",
      keyConfidence: 0.3,
      fullLevel: 0.6,
      suggestedHook: { start: 60, end: 90, confidence: 0.5 },
      suggestedDialogue: null,
    };
    const songs = {
      a: t("a", "Bollywood/a.mp3", { analysis }),
      s: t("s", "session:x.wav", { analysis, hotCues: [12, null] }),
      p: t("p", "Punjabi/p.mp3", { status: "pending" }),
    };

    it("carries each analysed song's analysis (levels rounded, the admin's drop threshold left to the edits)", () => {
      const f = buildSettingsFile(settings, songs, 1);
      expect(Object.keys(f.analysis!)).toEqual(["a"]);
      expect(f.analysis!.a.analysis.barLevels).toEqual([0.123, 1, 0.5]);
      expect(f.analysis!.a.analysis.fullLevel).toBeUndefined();
      expect(f.analysis!.a.title).toBe("Bollywood/a.mp3");
    });

    it("a file to download has the session songs too, under their file names", () => {
      const f = buildSettingsFile(settings, songs, 1, true);
      expect(Object.keys(f.analysis!).sort()).toEqual(["a", "s"]);
      expect(f.tracks.s.path).toBe("x.wav");
    });

    it("reads it back; analyses from an older version, or broken ones, are dropped", () => {
      const f = buildSettingsFile(settings, songs, 1);
      const raw = JSON.parse(JSON.stringify(f));
      raw.analysis.old = { title: "old", analysis: { ...raw.analysis.a.analysis, version: ANALYSIS_VERSION - 1 } };
      raw.analysis.bad = { title: "bad", analysis: { bpm: "fast" } };
      const back = parseSettingsFile(JSON.stringify(raw))!;
      expect(Object.keys(back.analysis!)).toEqual(["a"]);
      expect(back.analysis!.a.analysis).toMatchObject({ bpm: 126, detectedKey: "8A", suggestedHook: { start: 60, end: 90 }, suggestedDialogue: null });
      expect(contentKey(back)).toBe(contentKey(f));
      // A file written before analysis was added reads as before.
      expect(parseSettingsFile(JSON.stringify({ ...raw, analysis: undefined }))!.analysis).toEqual({});
    });

    it("fills in only songs that still need analysing, matched by content id (never by path)", () => {
      const f = buildSettingsFile(settings, { ...songs, p: t("p", "Punjabi/p.mp3", { analysis }) }, 1);
      const here = {
        a: t("a", "Bollywood/a.mp3", { analysis }),
        p: t("p", "Renamed/p.mp3", { status: "pending" }),
        x: t("x", "Bollywood/a.mp3", { status: "pending" }),
        q: t("q", "q.mp3", { analysis: { ...analysis, version: ANALYSIS_VERSION - 1 } }),
      };
      const file = { ...f, analysis: { ...f.analysis, q: { title: "q", analysis } } };
      expect(Object.keys(analysesFor(file, here)).sort()).toEqual(["p", "q"]);
    });
  });
});
