import type { Mood, MoodId } from "@/lib/types";

// Mood presets are the only "input" the auto-DJ gets once the night starts.
// Tune them here; the selector reads nothing else about intent.
export const MOODS: Mood[] = [
  {
    id: "chill",
    name: "Chill",
    description: "Laid-back, low energy, slower tempos",
    bpm: [96, 115],
    energy: [0.15, 0.45],
    genres: ["chill", "chillout", "downtempo", "lounge", "deep house", "ambient", "lofi"],
    blendBars: 32,
  },
  {
    id: "warmup",
    name: "Warm-up",
    description: "Early night, building slowly",
    bpm: [112, 122],
    energy: [0.3, 0.6],
    genres: ["deep house", "house", "nu disco", "indie dance", "organic house"],
    blendBars: 32,
  },
  {
    id: "groove",
    name: "Groove",
    description: "Steady, danceable, mid energy",
    bpm: [118, 126],
    energy: [0.45, 0.75],
    genres: ["house", "tech house", "disco", "funky house", "afro house"],
    blendBars: 16,
  },
  {
    id: "peak",
    name: "Peak Hour",
    description: "Full floor, highest energy",
    bpm: [124, 132],
    energy: [0.7, 1],
    genres: ["tech house", "techno", "electro", "big room", "edm", "bass house"],
    blendBars: 16,
  },
  {
    id: "afterhours",
    name: "Afterhours",
    description: "Late night, hypnotic and deep",
    bpm: [120, 130],
    energy: [0.5, 0.8],
    genres: ["minimal", "deep tech", "progressive", "melodic techno", "techno"],
    blendBars: 32,
  },
];

export const DEFAULT_MOOD: MoodId = "warmup";

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
