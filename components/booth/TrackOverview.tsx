"use client";

import { useMemo, useRef } from "react";
import { drops } from "@/lib/analysis/structure";
import type { Track } from "@/lib/types";
import { useBoothFrame } from "./frame";

/**
 * Whole-track overview: one bar per musical bar, height = bass level, drops in
 * the mood colour. Shows the playhead and, on the live deck, where the next
 * mix starts.
 */
export function TrackOverview({ deck, track, color, live }: { deck: number; track: Track | null; color: string; live: boolean }) {
  const a = track?.analysis ?? null;
  const playhead = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);

  const bars = useMemo(() => {
    if (!a?.barLevels?.length) return [];
    const barSec = (60 / a.bpm) * 4;
    const inDrop = new Set<number>();
    for (const d of drops(a.barLevels, a.fullLevel)) for (let b = d.start; b < d.end; b++) inDrop.add(b);
    return a.barLevels.map((level, b) => ({
      x: ((a.firstBeat + b * barSec) / a.duration) * 1000,
      w: Math.max(1, (barSec / a.duration) * 1000 - 1.5),
      h: Math.max(2, level * 36),
      drop: inDrop.has(b),
    }));
  }, [a]);

  useBoothFrame((snap) => {
    const view = snap?.decks[deck] ?? null;
    const pct = a && view ? Math.min(100, (view.position / a.duration) * 100) : 0;
    if (playhead.current) playhead.current.style.left = `${pct}%`;
    if (played.current) played.current.style.width = `${pct}%`;
    if (marker.current) {
      const at = live && a && snap?.mixOutPosition != null ? (snap.mixOutPosition / a.duration) * 100 : null;
      marker.current.style.display = at === null ? "none" : "block";
      if (at !== null) marker.current.style.left = `${at}%`;
    }
  });

  return (
    <div className="relative h-12 overflow-hidden rounded-lg bg-black/40" aria-hidden>
      {bars.length > 0 ? (
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {bars.map((b, i) => (
            <rect key={i} x={b.x} y={20 - b.h / 2} width={b.w} height={b.h} rx="0.5" fill={b.drop ? color : "#4b4b63"} />
          ))}
        </svg>
      ) : (
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      )}
      <div ref={played} className="absolute inset-y-0 left-0 bg-black/45" style={{ width: 0 }} />
      <div ref={marker} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" style={{ display: "none" }}>
        <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-none text-white">▼</span>
      </div>
      <div ref={playhead} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_white]" style={{ left: 0 }} />
    </div>
  );
}
