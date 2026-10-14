"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
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

/** Turning a wheel that sets a start point: one full turn = 16 beats (4 bars); with Shift, 4 beats. */
const BEATS_PER_TURN = 16;
const FINE_BEATS_PER_TURN = 4;
/** Scroll / keys save the start point once they pause for this long (ms). */
const COMMIT_AFTER = 350;

/** Makes the wheel set a deck's start point (loaded or cued decks only — never the one on air). */
export interface JogScrub {
  /** The start point it shows (track seconds). */
  position: number;
  duration: number;
  /** Seconds per beat of the track. */
  beat: number;
  /** Spoken label, e.g. "Start point, Deck A". */
  label: string;
  /** Shown value, e.g. "Bar 11.2". */
  valueText: (position: number) => string;
  /** While turning: move the flag and the shown start. */
  onMove: (position: number) => void;
  /** Done turning: save it (snapped to the beat). */
  onCommit: (position: number) => void;
}

/**
 * The deck's jog wheel. On air it is display-only: the platter turns with the
 * track position, so it speeds up or slows down as the auto-DJ syncs tempo,
 * and the ring lights the beat in the bar (beat 1 brightest) so two
 * beat-matched decks flash together. With `scrub` (a loaded or cued deck) it
 * sets the start point: drag it round (Shift = fine), scroll over it, or use
 * the keys — ←/→ one beat, Shift+←/→ one bar, PageUp/PageDown 8 bars, Home the beginning.
 */
export function JogWheel({
  deck,
  track,
  color,
  scrub,
  children,
}: {
  deck: number;
  track: Track | null;
  color: string;
  scrub?: JogScrub;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const platter = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const beats = useRef<(SVGPathElement | null)[]>([]);
  // The start point while turning (null when idle), and a pending save for scroll / keys.
  const turning = useRef<number | null>(null);
  const drag = useRef<{ angle: number } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(scrub);
  useEffect(() => {
    latest.current = scrub;
  });

  const move = (position: number) => {
    const s = latest.current;
    if (!s) return;
    const p = Math.max(0, Math.min(s.duration - 1, position));
    turning.current = p;
    s.onMove(p);
    root.current?.setAttribute("aria-valuetext", s.valueText(p));
  };
  const commit = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    const p = turning.current;
    turning.current = null;
    if (p !== null) latest.current?.onCommit(p);
  };
  const commitSoon = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commit, COMMIT_AFTER);
  };
  const stepBeats = (n: number) => {
    const s = latest.current;
    if (!s) return;
    move((turning.current ?? s.position) + n * s.beat);
    commitSoon();
  };

  // Scroll over the wheel: one beat per notch. Native listener so the page doesn't scroll too.
  useEffect(() => {
    const el = root.current;
    if (!el || !scrub) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepBeats(Math.sign(e.deltaY || e.deltaX) || 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // stepBeats reads the latest props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!scrub]);

  const angleOf = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return (Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrub) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { angle: angleOf(e) };
    turning.current = scrub.position;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = latest.current;
    if (!drag.current || !s) return;
    const angle = angleOf(e);
    let delta = angle - drag.current.angle;
    delta -= 360 * Math.round(delta / 360);
    drag.current.angle = angle;
    const perTurn = e.shiftKey ? FINE_BEATS_PER_TURN : BEATS_PER_TURN;
    move((turning.current ?? s.position) + (delta / 360) * perTurn * s.beat);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!scrub) return;
    const keys: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 32, PageDown: -32 };
    if (e.key === "Home") {
      e.preventDefault();
      move(0);
      commitSoon();
    } else if (e.key in keys) {
      e.preventDefault();
      stepBeats(keys[e.key] * (e.shiftKey && Math.abs(keys[e.key]) === 1 ? 4 : 1));
    }
  };

  useBoothFrame((snap) => {
    const view = snap?.decks[deck] ?? null;
    const a = track?.analysis;
    if (platter.current) {
      const s = latest.current;
      // A wheel that sets a start point shows it (turning with it); on air it shows the playing position.
      const angle = s
        ? (((turning.current ?? s.position) / s.beat) * (360 / BEATS_PER_TURN)) % 360
        : view
          ? (view.position * DEG_PER_SECOND) % 360
          : 0;
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
    <div
      ref={root}
      className={`relative aspect-square w-full touch-none select-none rounded-full outline-none ${
        scrub ? "cursor-grab focus-visible:ring-2 active:cursor-grabbing" : ""
      }`}
      style={scrub ? ({ "--tw-ring-color": color } as React.CSSProperties) : undefined}
      {...(scrub
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label": scrub.label,
            "aria-valuemin": 0,
            "aria-valuemax": Math.round(scrub.duration),
            "aria-valuenow": Math.round(scrub.position),
            "aria-valuetext": scrub.valueText(scrub.position),
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onKeyDown,
          }
        : { "aria-hidden": true })}
    >
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
