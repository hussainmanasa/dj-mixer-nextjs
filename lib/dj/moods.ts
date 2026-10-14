import type { Mood, MoodId } from "@/lib/types";

// Mood presets are the only "input" the auto-DJ gets once the night starts.
// Tune them here; the selector reads nothing else about intent.
//
// How long a track plays: like a club DJ, the auto-DJ leaves a track when it
// breaks down after its main drop (`mixOutAfterDrops`), not at the end of the
// file. Chill and Afterhours let tracks run through a second drop. Peak Hour
// swaps straight onto the next track's drop (`dropSwap`) instead of blending.
export const MOODS: Mood[] = [
  {
    id: "chill",
    name: "Chill",
    description: "Laid-back, low energy, slower tempos",
    bpm: [96, 115],
    energy: [0.15, 0.45],
    genres: ["chill", "chillout", "downtempo", "lounge", "deep house", "ambient", "lofi"],
    blendBars: 32,
    mixOutAfterDrops: 2,
    maxPlayBars: 128,
    dropSwap: false,
  },
  {
    id: "warmup",
    name: "Warm-up",
    description: "Early night, building slowly",
    bpm: [112, 122],
    energy: [0.3, 0.6],
    genres: ["deep house", "house", "nu disco", "indie dance", "organic house"],
    blendBars: 32,
    mixOutAfterDrops: 1,
    maxPlayBars: 128,
    dropSwap: false,
  },
  {
    id: "groove",
    name: "Groove",
    description: "Steady, danceable, mid energy",
    bpm: [118, 126],
    energy: [0.45, 0.75],
    genres: ["house", "tech house", "disco", "funky house", "afro house"],
    blendBars: 16,
    mixOutAfterDrops: 1,
    maxPlayBars: 112,
    dropSwap: false,
  },
  {
    id: "peak",
    name: "Peak Hour",
    description: "Full floor, highest energy",
    bpm: [124, 132],
    energy: [0.7, 1],
    genres: ["tech house", "techno", "electro", "big room", "edm", "bass house"],
    blendBars: 16,
    mixOutAfterDrops: 1,
    maxPlayBars: 96,
    dropSwap: true,
  },
  {
    id: "afterhours",
    name: "Afterhours",
    description: "Late night, hypnotic and deep",
    bpm: [120, 130],
    energy: [0.5, 0.8],
    genres: ["minimal", "deep tech", "progressive", "melodic techno", "techno"],
    blendBars: 32,
    mixOutAfterDrops: 2,
    maxPlayBars: 160,
    dropSwap: false,
  },
  {
    id: "desi",
    name: "Desi Night",
    description: "Bollywood & Punjabi: a slow opener's hook, then drop after drop",
    bpm: [90, 135],
    energy: [0.5, 1],
    genres: ["bollywood", "punjabi", "bhangra", "desi", "hindi", "filmi", "indian"],
    blendBars: 16,
    crates: ["Bollywood party", "Punjabi"],
    mixOutAfterDrops: 1,
    maxPlayBars: 128,
    dropSwap: true,
    // Opens with a romantic hook, auto-drops into the party, then each song
    // plays until staff press Drop (it still mixes out near its end).
    opener: { crates: ["Romantic"], maxBpm: 105 },
    holdForDrop: true,
  },
];

export const DEFAULT_MOOD: MoodId = "warmup";

/** Admin edits to the presets (Moods page), stored with the settings. */
export type MoodOverrides = Partial<Record<MoodId, Partial<Omit<Mood, "id">>>>;

/** A preset with the admin's edits applied. */
export function resolveMood(id: MoodId, overrides: MoodOverrides = {}): Mood {
  return { ...getMood(id), ...overrides[id], id };
}

export function resolveMoods(overrides: MoodOverrides = {}): Mood[] {
  return MOODS.map((m) => resolveMood(m.id, overrides));
}

export const BLEND_BAR_OPTIONS = [8, 16, 32, 64] as const;

/** Problems with an edited mood, as messages for the editor (empty = valid). */
export function validateMood(m: Mood): string[] {
  const errors: string[] = [];
  const [lo, hi] = m.bpm;
  if (!(lo >= 60 && hi <= 200 && lo < hi)) errors.push("BPM range must go from low to high, within 60–200.");
  const [elo, ehi] = m.energy;
  if (!(elo >= 0 && ehi <= 1 && elo < ehi)) errors.push("Energy range must go from low to high, within 0–1.");
  if (!(BLEND_BAR_OPTIONS as readonly number[]).includes(m.blendBars)) errors.push("Blend length must be 8, 16, 32 or 64 bars.");
  if (!(Number.isInteger(m.mixOutAfterDrops) && m.mixOutAfterDrops >= 1 && m.mixOutAfterDrops <= 4))
    errors.push("Leave after drop 1, 2, 3 or 4.");
  if (!(m.maxPlayBars >= 32 && m.maxPlayBars <= 512 && m.maxPlayBars % 8 === 0))
    errors.push("Longest play must be 32–512 bars, in steps of 8.");
  if (!m.name.trim()) errors.push("Give the mood a name.");
  if (m.opener && !(m.opener.maxBpm >= 60 && m.opener.maxBpm <= 200)) errors.push("The opener's top BPM must be within 60–200.");
  return errors;
}

export function getMood(id: MoodId): Mood {
  const mood = MOODS.find((m) => m.id === id);
  if (!mood) throw new Error(`Unknown mood: ${id}`);
  return mood;
}

/**
 * Target energy for the n-th track played in a mood: a gentle wave across the
 * mood's energy band (8-track period) so long sets breathe instead of flat-lining.
 */
export function targetEnergy(mood: Mood, trackIndexInMood: number): number {
  const [lo, hi] = mood.energy;
  const wave = 0.5 + 0.35 * Math.sin((2 * Math.PI * trackIndexInMood) / 8);
  return lo + (hi - lo) * wave;
}
