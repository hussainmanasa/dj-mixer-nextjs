// Library health checks for the admin "Needs attention" filter. PURE.

import { drops } from "@/lib/analysis/structure";
import { MAX_BOOST_DB, MAX_CUT_DB, trimDb } from "@/lib/analysis/loudness";
import { MIN_BLEND_CONFIDENCE } from "@/lib/dj/selector";
import type { Track } from "@/lib/types";

export type IssueKind = "failed" | "grid" | "noDrops" | "noKey" | "duplicate" | "level" | "short";

export interface Issue {
  kind: IssueKind;
  message: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Same title and artist (ignoring case, punctuation and "(Extended Mix)"-style suffixes). */
export function duplicateKey(t: Track): string {
  return `${norm(t.artist)}|${norm(t.title)}`;
}

/** What's wrong with a track, given the whole library (duplicates, typical loudness). */
export function trackIssues(t: Track, duplicates: Map<string, number>, targetLoudness?: number): Issue[] {
  const issues: Issue[] = [];
  if (t.status === "error") issues.push({ kind: "failed", message: t.error ?? "Could not be read" });
  const a = t.analysis;
  if (a) {
    if (a.beatConfidence < MIN_BLEND_CONFIDENCE) issues.push({ kind: "grid", message: "Unsure beat grid: only cuts, no blends" });
    if (a.barLevels && a.duration > 150 && drops(a.barLevels, a.fullLevel).length === 0)
      issues.push({ kind: "noDrops", message: "No drops found: mixes out at the outro" });
    const trim = trimDb(a.loudness, targetLoudness);
    if (trim >= MAX_BOOST_DB) issues.push({ kind: "level", message: "Much quieter than the rest: boost is capped" });
    if (trim <= MAX_CUT_DB) issues.push({ kind: "level", message: "Much louder than the rest: cut is capped" });
    if (a.duration < 90) issues.push({ kind: "short", message: "Shorter than 1:30" });
  }
  if (t.status === "ready" && !t.camelot) issues.push({ kind: "noKey", message: "Key unknown: no harmonic matching" });
  if ((duplicates.get(duplicateKey(t)) ?? 0) > 1) issues.push({ kind: "duplicate", message: "Possible duplicate (same title and artist)" });
  return issues;
}

/** How many tracks share each duplicate key. */
export function duplicateCounts(tracks: Track[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(duplicateKey(t), (counts.get(duplicateKey(t)) ?? 0) + 1);
  return counts;
}
