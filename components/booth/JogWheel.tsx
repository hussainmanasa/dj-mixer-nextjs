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

/** Scroll / keys save the start point once they pause for this long (ms). */
const COMMIT_AFTER = 350;
/** Let go while spinning the song on air backwards faster than this (°/s, ~3 turns a second): a spinback. */
const FLING_DEG_PER_SECOND = -1080;
/** The spin speed at release is measured over the last this many ms of the drag. */
const FLING_WINDOW_MS = 120;
/** Trackpad two-finger swipe: this many pixels of scroll turn the wheel once. */
const PX_PER_TURN = 600;
/** A two-finger swipe has ended once no scroll arrives for this long (ms; momentum scrolling keeps it going). */
const SWIPE_END_MS = 160;

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
 * With `scrub` it can be turned: drag it round with one finger or the mouse,
 * twist it with two fingers on a touchscreen, swipe two fingers on a trackpad
 * (up = forwards, down = back; Shift = fine for all of these), click a mouse
 * wheel (one beat a notch), or use the keys — ←/→ one beat, Shift+←/→ one bar,
 * PageUp/PageDown 8 bars, Home the beginning. A fast backward turn of the song
 * on air is a spinback (`live.onFling`). On a loaded or cued deck that sets the start point; on
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
  // One finger / the mouse: its angle round the centre. Two fingers: the angle of the line between them.
  const drag = useRef<{ angle: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const twist = useRef<number | null>(null);
  // The last moves (for the spinback's speed), and a trackpad swipe in progress.
  const recent = useRef<{ t: number; deg: number }[]>([]);
  const swipe = useRef<{ timer: ReturnType<typeof setTimeout> | null; spun: boolean } | null>(null);
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

  /** Take hold: the song on air stops under the hand; a turn starts from where the wheel is. */
  const grab = () => {
    const s = latest.current;
    if (!s || turning.current !== null) return;
    s.live?.onGrab();
    turning.current = from(s);
    recent.current = [];
  };
  /** Turn the wheel by `deg` (clockwise = forwards). */
  const turn = (deg: number, fine: boolean) => {
    const s = latest.current;
    if (!s) return;
    const t = performance.now();
    recent.current = [...recent.current.filter((r) => t - r.t < FLING_WINDOW_MS), { t, deg }];
    // Every wheel turns like vinyl (one turn ≈ 1.8 s of audio; fine: a quarter as far), so a scratch sounds the
    // same on every deck. A start point still snaps to the beat when it's let go.
    const seconds = (deg / DEG_PER_SECOND) * (fine ? 0.25 : 1);
    move(from(s) + seconds);
  };
  /** Turning backwards fast on the song on air: spin it back (instead of letting go normally). */
  const fling = (): boolean => {
    const s = latest.current;
    const now = performance.now();
    const r = recent.current.filter((x) => now - x.t < FLING_WINDOW_MS);
    const span = r.length > 1 ? (now - r[0].t) / 1000 : 0;
    const speed = span > 0.03 ? r.reduce((sum, x) => sum + x.deg, 0) / span : 0;
    if (!s?.live?.onFling || turning.current === null || speed >= FLING_DEG_PER_SECOND) return false;
    const p = turning.current;
    turning.current = null;
    recent.current = [];
    s.live.onFling(p);
    return true;
  };

  // Scroll over the wheel: a mouse wheel steps one beat a notch; a trackpad's two-finger swipe turns it
  // (and a fast swipe back on the song on air spins it back). Native listener so the page doesn't scroll too —
  // always on, even while the wheel has nothing to turn: right after a spinback the deck's song goes, and the rest of
  // the swipe's momentum would otherwise scroll the page (up to the top, with a fast swipe).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || !latest.current) return; // a pinch, or nothing to turn
      const px = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!px) return;
      const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY));
      if (notch && !swipe.current) {
        stepBeats(Math.sign(px));
        return;
      }
      const sw = (swipe.current ??= { timer: null, spun: false });
      if (sw.timer) clearTimeout(sw.timer);
      sw.timer = setTimeout(() => {
        swipe.current = null;
        if (!sw.spun) commit();
      }, SWIPE_END_MS);
      // After a spinback the rest of the swipe (and its momentum) is ignored.
      if (sw.spun) return;
      grab();
      turn((px * 360) / PX_PER_TURN, e.shiftKey);
      if (fling()) sw.spun = true;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // stepBeats, grab, turn and fling read the latest props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Angle (°) of a point round the wheel's centre. */
  const centreAngle = (x: number, y: number) => {
    const box = root.current!.getBoundingClientRect();
    return (Math.atan2(y - (box.top + box.height / 2), x - (box.left + box.width / 2)) * 180) / Math.PI;
  };
  /** Angle (°) of the line between the first two fingers. */
  const pairAngle = () => {
    const [a, b] = [...pointers.current.values()];
    return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  };
  const wrap = (d: number) => d - 360 * Math.round(d / 360);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!scrub) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (e.g. synthetic): it still works without capture */
    }
    e.currentTarget.focus();
    // A key / scroll step waiting to be saved: this turn carries it on (and saves it when let go).
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      // A hand on the song on air stops it where it is.
      grab();
      drag.current = { angle: centreAngle(e.clientX, e.clientY) };
    } else if (pointers.current.size === 2) {
      twist.current = pairAngle();
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !latest.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && twist.current !== null) {
      // Two fingers: twisting turns it.
      const angle = pairAngle();
      const delta = wrap(angle - twist.current);
      twist.current = angle;
      turn(delta, e.shiftKey);
    } else if (drag.current) {
      const angle = centreAngle(e.clientX, e.clientY);
      const delta = wrap(angle - drag.current.angle);
      drag.current.angle = angle;
      turn(delta, e.shiftKey);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 1) {
      // Back to one finger: carry on from where it is, without a jump.
      const [p] = pointers.current.values();
      twist.current = null;
      drag.current = { angle: centreAngle(p.x, p.y) };
      return;
    }
    if (pointers.current.size > 0) return;
    drag.current = null;
    twist.current = null;
    // Let go while turning back fast on the song on air: spin it back; else let go normally.
    if (turning.current !== null && !fling()) commit();
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
          ? ((turning.current ?? s.position) * DEG_PER_SECOND) % 360
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
