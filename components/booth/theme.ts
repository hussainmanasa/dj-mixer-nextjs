import type { MoodId } from "@/lib/types";

/** Accent colour per mood: tints the booth, the jog wheels and the beat pulse. */
export const MOOD_COLOR: Record<MoodId, string> = {
  chill: "#22d3ee",
  warmup: "#fbbf24",
  groove: "#34d399",
  peak: "#f472b6",
  afterhours: "#a78bfa",
  desi: "#fb923c",
};

export const DECK_LETTERS = ["A", "B", "C", "D"] as const;
