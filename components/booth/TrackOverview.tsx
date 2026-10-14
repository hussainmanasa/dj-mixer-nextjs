"use client";

import { useMemo, useRef } from "react";
import { drops } from "@/lib/analysis/structure";
import { dialogueOf, hookOf } from "@/lib/dj/cues";
import type { Track } from "@/lib/types";
import { useBoothFrame } from "./frame";

/**
 * Whole-track overview: one bar per musical bar, height = bass level, drops in
 * the mood colour, marked dialogue (amber) and hook (green) along the top.
 * Shows the playhead, on the live deck where the next mix starts, and on the
 * cued deck where it will start (`startAt`; tap a bar to change it).
 */
export function TrackOverview({
  deck,
  track,
  color,
  live,
  startAt,
  onPickBar,
}: {
  deck: number;
  track: Track | null;
  color: string;
  live: boolean;
  startAt?: number;
  onPickBar?: (bar: number) => void;
}) {
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

  const marks = useMemo(() => {
    if (!a || !track) return [];
    const pct = (t: number) => Math.max(0, Math.min(100, (t / a.duration) * 100));
    return [
      { label: "Dialogue", range: dialogueOf(track.cues), color: "var(--warn)" },
      { label: "Hook", range: hookOf(track.cues), color: "var(--good)" },
    ].flatMap((m) => (m.range ? [{ ...m, left: pct(m.range.start), width: pct(m.range.end) - pct(m.range.start) }] : []));
  }, [a, track]);

  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPickBar || !a) return;
    const box = e.currentTarget.getBoundingClientRect();
    const time = ((e.clientX - box.left) / box.width) * a.duration;
    onPickBar(Math.max(0, Math.round((time - a.firstBeat) / ((60 / a.bpm) * 4))));
  };

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
    <div
      className={`relative h-12 overflow-hidden rounded-lg bg-black/40 ${onPickBar ? "cursor-pointer" : ""}`}
      aria-hidden
      onClick={pick}
      title={onPickBar ? "Tap a bar to start the song there" : undefined}
    >
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
      {marks.map((m) => (
        <div key={m.label} className="absolute top-0 h-1.5 rounded-b-sm" style={{ left: `${m.left}%`, width: `${Math.max(0.5, m.width)}%`, background: m.color }} />
      ))}
      {startAt !== undefined && a && (
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2" style={{ left: `${(startAt / a.duration) * 100}%`, background: color }}>
          <span className="absolute -top-0.5 left-0.5 text-[10px] leading-none" style={{ color }}>
            ⚑
          </span>
        </div>
      )}
      <div ref={playhead} className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_6px_white]" style={{ left: 0 }} />
    </div>
  );
}
