// Track structure from per-bar bass levels (TrackAnalysis.barLevels): where
// the breakdowns and drops are. PURE: no browser APIs, unit-tested.
//
// Club tracks alternate between "full" sections (kick + bassline) and quieter
// breakdowns with the kick and bass taken out. A drop is the full section that
// comes back after a breakdown; an intro that builds into the beat is not one.

/**
 * A bar counts as full at or above this level. Low enough that a kick-only
 * intro (≈0.4–0.6 of a kick + bassline bar) counts as full, so it isn't merged
 * with the first breakdown; breakdowns without a kick sit around 0.1–0.2.
 */
export const FULL_LEVEL = 0.3;
/** Quiet runs shorter than this are fills, not breakdowns. */
const MIN_LOW_BARS = 4;
/** Full runs shorter than this are teases inside a breakdown, not sections. */
const MIN_FULL_BARS = 8;

/** A run of bars, `start` inclusive, `end` exclusive (bar indices from the first downbeat). */
export interface Section {
  start: number;
  end: number;
  full: boolean;
}

/**
 * Split a track into alternating full / quiet sections, ignoring fills and
 * teases. `fullLevel` is the per-track threshold an admin may set.
 */
export function sections(levels: number[], fullLevel = FULL_LEVEL): Section[] {
  const runs: Section[] = [];
  for (let b = 0; b < levels.length; b++) {
    const full = levels[b] >= fullLevel;
    const last = runs[runs.length - 1];
    if (last && last.full === full) last.end = b + 1;
    else runs.push({ start: b, end: b + 1, full });
  }
  // Absorb runs too short to be a section into their neighbours, shortest first.
  // Runs alternate, so the merged run takes the neighbours' kind.
  while (runs.length > 1) {
    let idx = -1;
    for (let i = 0; i < runs.length; i++) {
      const len = runs[i].end - runs[i].start;
      if (len >= (runs[i].full ? MIN_FULL_BARS : MIN_LOW_BARS)) continue;
      if (idx < 0 || len < runs[idx].end - runs[idx].start) idx = i;
    }
    if (idx < 0) break;
    const from = Math.max(0, idx - 1);
    const to = Math.min(runs.length - 1, idx + 1);
    runs.splice(from, to - from + 1, { start: runs[from].start, end: runs[to].end, full: !runs[idx].full });
  }
  return runs;
}

/** Full sections that follow a breakdown (a quiet section with music before it). */
export function drops(levels: number[], fullLevel = FULL_LEVEL): Section[] {
  // Runs alternate, so a full run at index ≥ 2 has a breakdown and a full run before it.
  return sections(levels, fullLevel).filter((s, i) => s.full && i >= 2);
}
