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
/** Let go while spinning the song on air backwards faster than this (°/s, ~3 turns a second): a spinback. */
const FLING_DEG_PER_SECOND = -1080;
/** The spin speed at release is measured over the last this many ms of the drag. */
const FLING_WINDOW_MS = 120;

/**
 * Makes the wheel turnable: on a loaded or cued deck it sets the start point;
 * with `live` (the song on air, playing or paused) it moves the song itself.
 */
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
  /** While turning: move the flag and the shown start; `step` for a key / scroll step (else a drag). */
  onMove: (position: number, step: boolean) => void;
  /** Done turning: save it (snapped to the beat), or let the song play on from there. */
  onCommit: (position: number) => void;
  /**
   * The song on air: the wheel turns like a record (200° per second of audio)
   * from wherever the song is; touching it stops the song (`onGrab`).
   */
  live?: {
    position: () => number;
    onGrab: () => void;
    /** Let go while flicking it backwards fast: spin back (instead of `onCommit`). */
    onFling?: (position: number) => void;
  };
}

/**
 * The deck's jog wheel. The platter turns with the track position, so it
 * speeds up or slows down as the auto-DJ syncs tempo, and the ring lights the
 * beat in the bar (beat 1 brightest) so two beat-matched decks flash together.
 * With `scrub` it can be turned: drag it round (Shift = fine), scroll over it,
 * or use the keys — ←/→ one beat, Shift+←/→ one bar, PageUp/PageDown 8 bars,
 * Home the beginning. On a loaded or cued deck that sets the start point; on
 * the song on air (`scrub.live`) it holds and moves the song like a record.
 */
export function JogWheel({
  deck,
  track,
  color,
  scrub,
  art,
  children,
}: {
  deck: number;
  track: Track | null;
  color: string;
  scrub?: JogScrub;
  /** Cover art for the record's label (it turns with the platter); without it the label shows initials. */
  art?: string | null;
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const platter = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const beats = useRef<(SVGPathElement | null)[]>([]);
  // The start point while turning (null when idle), and a pending save for scroll / keys.
  const turning = useRef<number | null>(null);
  const drag = useRef<{ angle: number; recent: { t: number; deg: number }[] } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(scrub);
  useEffect(() => {
    latest.current = scrub;
  });

  const move = (position: number, step = false) => {
    const s = latest.current;
    if (!s) return;
    const p = Math.max(0, Math.min(s.duration - 1, position));
    turning.current = p;
    s.onMove(p, step);
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
  /** Where a turn starts: the start point, or where the song on air is now. */
  const from = (s: JogScrub) => turning.current ?? (s.live ? s.live.position() : s.position);
  const stepBeats = (n: number) => {
    const s = latest.current;
    if (!s) return;
    if (turning.current === null) s.live?.onGrab();
    move(from(s) + n * s.beat, true);
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
    drag.current = { angle: angleOf(e), recent: [] };
    // A hand on the song on air stops it where it is.
    if (turning.current === null) scrub.live?.onGrab();
    turning.current = from(scrub);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = latest.current;
    if (!drag.current || !s) return;
    const angle = angleOf(e);
    let delta = angle - drag.current.angle;
    delta -= 360 * Math.round(delta / 360);
    drag.current.angle = angle;
    const t = performance.now();
    drag.current.recent = [...drag.current.recent.filter((r) => t - r.t < FLING_WINDOW_MS), { t, deg: delta }];
    // On air: like vinyl (Shift: a quarter as far). Start point: beats per turn.
    const seconds = s.live
      ? (delta / DEG_PER_SECOND) * (e.shiftKey ? 0.25 : 1)
      : (delta / 360) * (e.shiftKey ? FINE_BEATS_PER_TURN : BEATS_PER_TURN) * s.beat;
    move(from(s) + seconds);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // Flicked backwards fast on the song on air: spin it back.
    const s = latest.current;
    const now = performance.now();
    const recent = d.recent.filter((r) => now - r.t < FLING_WINDOW_MS);
    const span = recent.length > 1 ? (now - recent[0].t) / 1000 : 0;
    const speed = span > 0 ? recent.reduce((sum, r) => sum + r.deg, 0) / span : 0;
    if (s?.live?.onFling && turning.current !== null && speed < FLING_DEG_PER_SECOND) {
      const p = turning.current;
      turning.current = null;
      s.live.onFling(p);
      return;
    }
    commit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!scrub) return;
    const keys: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 32, PageDown: -32 };
    if (e.key === "Home") {
      e.preventDefault();
      if (turning.current === null) scrub.live?.onGrab();
      move(0, true);
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
      // A wheel that sets a start point shows it (turning with it); on air it shows the song's position,
      // or where the hand has it.
      const angle =
        s && !s.live
          ? (((turning.current ?? s.position) / s.beat) * (360 / BEATS_PER_TURN)) % 360
          : turning.current !== null
            ? (turning.current * DEG_PER_SECOND) % 360
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
          <circle cx="100" cy="100" r="47" fill="#1b1b26" stroke="#2a2a38" />
        </svg>
        {/* The record's label: the song's cover art (or its initials), turning with the platter. */}
        {track && (
          <div className="absolute inset-[26%] overflow-hidden rounded-full border-2 border-black/60 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            {art ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
                <img src={art} alt="" className="h-full w-full object-cover" draggable={false} />
                <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#07070b] ring-1 ring-white/30" />
              </>
            ) : (
              <div
                className="grid h-full w-full place-items-center text-2xl font-bold text-black/70"
                style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #07070b))` }}
              >
                {initials(track.title)}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

/** Up to two initials of a title, for a label without cover art. */
function initials(title: string): string {
  const words = title.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
