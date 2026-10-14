// Set log for licence reports (e.g. PPL / IPRS in India): every track the
// booth played, grouped into club nights, exportable as CSV. PURE.

import type { SetLogEntry } from "@/lib/types";

/** Tracks before this local hour belong to the previous evening's night. */
export const NIGHT_CUTOVER_HOUR = 6;

export interface PlayedEntry extends SetLogEntry {
  /** Seconds it played: until the next track started, at most its length; null if unknown. */
  playedSec: number | null;
}

export interface Night {
  /** Local date the night started, "YYYY-MM-DD". */
  night: string;
  entries: PlayedEntry[];
  totalSec: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the night a timestamp belongs to (local time). */
export function nightOf(at: number): string {
  const d = new Date(at - NIGHT_CUTOVER_HOUR * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD HH:MM:SS" in local time. */
export function localTime(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Nights, newest first; entries in play order. */
export function groupNights(log: SetLogEntry[]): Night[] {
  const sorted = [...log].sort((a, b) => a.at - b.at);
  const nights = new Map<string, PlayedEntry[]>();
  sorted.forEach((e, i) => {
    const next = sorted[i + 1];
    const gap = next ? (next.at - e.at) / 1000 : null;
    const playedSec = gap === null ? null : Math.round(Math.min(gap, e.duration));
    const key = nightOf(e.at);
    nights.set(key, [...(nights.get(key) ?? []), { ...e, playedSec }]);
  });
  return [...nights.entries()]
    .map(([night, entries]) => ({ night, entries, totalSec: entries.reduce((s, e) => s + (e.playedSec ?? 0), 0) }))
    .sort((a, b) => (a.night < b.night ? 1 : -1));
}

function cell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HOW: Record<SetLogEntry["how"], string> = {
  start: "Set start",
  recovery: "Automatic recovery",
  blend: "Blend",
  filterSweep: "Filter sweep",
  echoOut: "Echo-out",
  cut: "Cut",
  drop: "Drop swap",
  dialogue: "Dialogue then drop",
};

/** CSV with a header row, one line per track played. */
export function toCsv(nights: Night[]): string {
  const rows = [["Night", "Started", "Played (s)", "Title", "Artist", "File", "Mood", "Came in by", "Requested", "BPM", "Key"]];
  for (const n of [...nights].reverse()) {
    for (const e of n.entries) {
      rows.push([
        n.night,
        localTime(e.at),
        e.playedSec === null ? "" : String(e.playedSec),
        e.title,
        e.artist,
        e.path,
        e.mood,
        HOW[e.how],
        e.requested ? "yes" : "no",
        e.bpm.toFixed(1),
        e.key ?? "",
      ]);
    }
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Keep the log bounded (IndexedDB is plenty big, but reports never need more). */
export const MAX_LOG_ENTRIES = 20000;
