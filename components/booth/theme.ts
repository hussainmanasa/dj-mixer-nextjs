import type { CSSProperties } from "react";
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

/**
 * The controller's look (DDJ-FLX4-style): a matte black panel with small silver labels. `PANEL` for a deck or
 * the mixer, `LABEL` for the printed names beside the controls.
 */
export const PANEL =
  "rounded-[1.75rem] border border-[#2a2a31] bg-[linear-gradient(180deg,#1b1b20,#111114)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_40px_rgba(0,0,0,0.55)]";
export const LABEL = "text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9a9aa6]";
/** A small rectangular rubber button (loop section, pad modes, LOAD). */
export const SMALL_BUTTON =
  "rounded-md border border-[#34343c] bg-[#202026] px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#d4d4dc] shadow-[0_2px_0_#09090b] transition active:translate-y-px active:shadow-none disabled:cursor-not-allowed disabled:opacity-35";

/** A performance pad: dark rubber, lit in `color` (null: unlit). */
export function padStyle(color: string | null): CSSProperties {
  return color
    ? { borderColor: color, background: `color-mix(in srgb, ${color} 30%, #141418)`, boxShadow: `0 0 12px color-mix(in srgb, ${color} 35%, transparent), inset 0 1px 0 rgba(255,255,255,0.08)`, color: "#f4f4f5" }
    : { borderColor: "#2e2e36", background: "#18181c", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 0 #08080a", color: "#8a8a96" };
}
