import { describe, expect, it } from "vitest";
import { getMood, MOODS, resolveMood, resolveMoods, validateMood } from "./moods";

describe("mood presets and edits", () => {
  it("every built-in preset is valid", () => {
    for (const m of MOODS) expect(validateMood(m)).toEqual([]);
  });

  it("applies admin edits on top of the preset", () => {
    const peak = resolveMood("peak", { peak: { bpm: [126, 134], crates: ["Friday"] } });
    expect(peak.bpm).toEqual([126, 134]);
    expect(peak.crates).toEqual(["Friday"]);
    expect(peak.blendBars).toBe(getMood("peak").blendBars);
    expect(resolveMoods({}).map((m) => m.id)).toEqual(MOODS.map((m) => m.id));
  });

  it("rejects impossible settings", () => {
    const bad = { ...getMood("chill"), bpm: [120, 100] as [number, number], blendBars: 12, maxPlayBars: 100, mixOutAfterDrops: 0, name: " " };
    expect(validateMood(bad)).toHaveLength(5);
  });
});
