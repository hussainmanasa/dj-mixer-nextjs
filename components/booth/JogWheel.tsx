"use client";

import { useRef, type ReactNode } from "react";
import { gridPosition } from "@/lib/dj/mixpoints";
import type { Track } from "@/lib/types";
import { useBoothFrame } from "./frame";

/** A real platter at 33⅓ rpm turns 200° per second of audio. */
const DEG_PER_SECOND = (33.333 / 60) * 360;

function polar(r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: 100 + r * Math.cos(rad), y: 100 + r * Math.sin(rad) };
}

function arc(r: number, from: number, to: number): string {
  const s = polar(r, from);
  const e = polar(r, to);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 0 1 ${e.x} ${e.y}`;
}

/**
 * Display-only jog wheel. The platter turns with the track position, so it
 * speeds up or slows down as the auto-DJ syncs tempo; the ring lights the
 * beat in the bar (beat 1 brightest) so two beat-matched decks flash together.
 */
export function JogWheel({ deck, track, color, children }: { deck: number; track: Track | null; color: string; children?: ReactNode }) {
  const platter = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const beats = useRef<(SVGPathElement | null)[]>([]);

  useBoothFrame((snap) => {
    const view = snap?.decks[deck] ?? null;
    const a = track?.analysis;
    if (platter.current) {
      const angle = view ? (view.position * DEG_PER_SECOND) % 360 : 0;
      platter.current.style.transform = `rotate(${angle}deg)`;
    }
    if (glow.current) glow.current.style.opacity = String(view ? 0.15 + view.fader * 0.55 : 0);
    const g = view?.started && a ? gridPosition(a, view.position) : null;
    beats.current.forEach((el, i) => {
      if (!el) return;
      const on = g && g.bar >= 0 && g.beat === i;
      el.style.opacity = on ? String((i === 0 ? 0.55 : 0.35) + 0.45 * (1 - g.phase)) : "0.12";
    });
  });

  return (
    <div className="relative aspect-square w-full" aria-hidden>
      <div ref={glow} className="absolute inset-[8%] rounded-full blur-2xl" style={{ background: color, opacity: 0 }} />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            ref={(el) => {
              beats.current[i] = el;
            }}
            d={arc(95, i * 90 + 6, i * 90 + 84)}
            fill="none"
            stroke={color}
            strokeWidth={i === 0 ? 7 : 5}
            strokeLinecap="round"
            style={{ opacity: 0.12 }}
          />
        ))}
      </svg>
      <div ref={platter} className="absolute inset-[9%] will-change-transform">
        <svg viewBox="0 0 200 200" className="h-full w-full">
          <circle cx="100" cy="100" r="99" fill="#0b0b12" stroke="#2a2a38" strokeWidth="2" />
          {[90, 80, 70, 60, 50].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          ))}
          <line x1="100" y1="5" x2="100" y2="38" stroke={color} strokeWidth="7" strokeLinecap="round" />
          <circle cx="100" cy="172" r="3" fill="rgba(255,255,255,0.25)" />
          <circle cx="100" cy="100" r="40" fill="#1b1b26" stroke="#2a2a38" />
        </svg>
      </div>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
