import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { getMood } from "./moods";
import { defaultStart, entryOptions, firstStart, openerWindow, resolveEntry, snapToBar, validateCues } from "./cues";
import { pickOpener } from "./selector";

// 120 BPM → 2 s bars from 0.5 s; drops at bars 64 (and 112).
const levels = [...Array(48).fill(1), ...Array(16).fill(0.1), ...Array(32).fill(1), ...Array(16).fill(0.1), ...Array(32).fill(1), ...Array(16).fill(0.2)];
function track(id: string, extra: Partial<Track> = {}, bpm = 120): Track {
  return {
    id,
    path: `${id}.mp3`,
    title: id,
    artist: "",
    genres: [],
    camelot: null,
    tagBpm: null,
    status: "ready",
    addedAt: 0,
    analysis: { bpm, firstBeat: 0.5, beatConfidence: 0.9, energy: 0.7, duration: 0.5 + levels.length * 2, introEnd: 0.5, outroStart: 300, barLevels: levels },
    ...extra,
  };
}

describe("resolveEntry", () => {
  const plain = track("plain");
  const marked = track("marked", { cues: { dialogueStart: 1.2, dialogueEnd: 6.4, hookStart: 20.5, hookEnd: 52.5 } });

  it("auto: plays the dialogue, then lands on the drop", () => {
    expect(resolveEntry(marked)).toEqual({ land: 128.5, dialogue: { start: 1.2, end: 6.4 } });
  });
  it("auto without a dialogue: lands on the detected drop", () => {
    expect(resolveEntry(plain)).toEqual({ land: 128.5 });
  });
  it("honours staff choices", () => {
    expect(resolveEntry(marked, { kind: "drop" })).toEqual({ land: 128.5 });
    expect(resolveEntry(marked, { kind: "hook" })).toEqual({ land: 20.5 });
    expect(resolveEntry(marked, { kind: "beginning" })).toEqual({ land: 0.5 });
    expect(resolveEntry(marked, { kind: "bar", bar: 10 })).toEqual({ land: 20.5 });
    // No hook marked: "hook" falls back to the drop.
    expect(resolveEntry(plain, { kind: "hook" })).toEqual({ land: 128.5 });
  });
  it("offers dialogue and hook only when marked", () => {
    expect(entryOptions(plain)).toEqual(["auto", "beginning", "drop"]);
    expect(entryOptions(marked)).toEqual(["auto", "beginning", "dialogue", "hook", "drop"]);
  });
});

describe("markers", () => {
  it("snaps to the nearest downbeat", () => {
    expect(snapToBar(track("t").analysis!, 21.2)).toBe(20.5);
    expect(snapToBar(track("t").analysis!, 21.6)).toBe(22.5);
  });
  it("uses the start marker as the default start", () => {
    expect(defaultStart(track("t"))).toBe(0.5);
    expect(defaultStart(track("t", { cues: { start: 8.5 } }))).toBe(8.5);
  });
  it("the opener plays its hook, else 32 bars from its start", () => {
    expect(openerWindow(track("t", { cues: { hookStart: 20.5, hookEnd: 52.5 } }))).toEqual({ start: 20.5, end: 52.5 });
    expect(openerWindow(track("t"))).toEqual({ start: 0.5, end: 64.5 });
  });
  it("rejects backwards or half-marked ranges", () => {
    expect(validateCues({ hookStart: 30, hookEnd: 20 }, 300)).toContain("The hook must end after it starts.");
    expect(validateCues({ dialogueStart: 5 }, 300)).toContain("Mark both the start and the end of the dialogue.");
    expect(validateCues({ start: 400 }, 300)).toContain("Markers must be inside the song.");
    expect(validateCues({ dialogueStart: 1, dialogueEnd: 6, hookStart: 20, hookEnd: 50 }, 300)).toEqual([]);
  });
});

describe("pickOpener", () => {
  const desi = getMood("desi");
  it("picks a slow song from the opener crate, preferring one with a hook marker", () => {
    const lib = [
      track("party", { crates: ["Bollywood party"] }, 128),
      track("romantic", { crates: ["Romantic"] }, 92),
      track("romanticHook", { crates: ["Romantic"], cues: { hookStart: 20.5, hookEnd: 52.5 } }, 95),
    ];
    expect(pickOpener(lib, desi, () => 0)?.id).toBe("romanticHook");
  });
  it("falls back to the slowest songs when the crate is empty", () => {
    const lib = [track("fast", {}, 128), track("slow", {}, 90)];
    expect(pickOpener(lib, desi, () => 0)?.id).toBe("slow");
  });
  it("is only for moods with an opener", () => {
    expect(pickOpener([track("t")], getMood("peak"))).toBeNull();
  });
});

describe("firstStart (a deck loaded before Play)", () => {
  const marked = track("marked", { cues: { dialogueStart: 1.2, dialogueEnd: 6.4, hookStart: 20.5, hookEnd: 52.5, start: 8.5 } });
  it("auto starts at the default start, or plays the hook as an opener", () => {
    expect(firstStart(marked)).toEqual({ start: 8.5 });
    expect(firstStart(marked, { kind: "auto" }, true)).toEqual({ start: 20.5, openerEnd: 52.5 });
  });
  it("dialogue plays the dialogue, then jumps to the drop", () => {
    expect(firstStart(marked, { kind: "dialogue" })).toEqual({ start: 1.2, jump: { after: 6.4 - 1.2, to: 128.5 } });
  });
  it("honours beginning, hook, drop and a bar", () => {
    expect(firstStart(marked, { kind: "beginning" })).toEqual({ start: 0 });
    expect(firstStart(marked, { kind: "hook" })).toEqual({ start: 20.5 });
    expect(firstStart(marked, { kind: "drop" })).toEqual({ start: 128.5 });
    expect(firstStart(marked, { kind: "bar", bar: 4 })).toEqual({ start: 8.5 });
  });
});
