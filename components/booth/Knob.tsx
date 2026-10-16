"use client";

import { useEffect, useId, useRef } from "react";
import { useWheel } from "./useWheel";

/** Knob sweep: −135° (min) … +135° (max), like a mixer's rotary. */
const SWEEP = 135;
/** Dragging this many pixels up or down turns a knob end to end. */
const DRAG_PX = 160;

/** Turn an indicator to `v` (−1 … +1, 0 = centre) — e.g. the auto-DJ's dot on a knob's ring, from the frame loop. */
export function setKnob(el: HTMLElement | null, v: number): void {
  if (el) el.style.transform = `rotate(${Math.max(-1, Math.min(1, v)) * SWEEP}deg)`;
}

/**
 * A rotary knob staff turn: drag up / down, scroll, or click it and use the arrow keys (Home / End for the ends);
 * double-click goes back to `reset`. A range input under the face carries the value, so it works with the keyboard
 * and screen readers like a slider. `auto` (optional) is a dot on the ring the frame loop turns with `setKnob` —
 * what the auto-DJ is doing on this channel.
 */
export function Knob({
  label,
  name,
  value,
  min = -1,
  max = 1,
  reset = 0,
  onChange,
  color,
  size = 32,
  auto,
  valueText,
  title,
}: {
  label: string;
  /** Accessible name, e.g. "Low, Deck A". */
  name: string;
  value: number;
  min?: number;
  max?: number;
  reset?: number;
  onChange: (value: number) => void;
  color?: string;
  size?: number;
  auto?: React.Ref<HTMLSpanElement>;
  valueText?: (value: number) => string;
  title?: string;
}) {
  const id = useId();
  const drag = useRef<{ y: number; from: number } | null>(null);
  const face = useRef<HTMLSpanElement>(null);
  const span = max - min;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const set = (v: number) => onChange(Math.round(clamp(v) * 100) / 100);
  // Scroll / a trackpad swipe turns it (the page stays put): a swipe like a drag, a mouse-wheel click 2%. Swipe
  // events come faster than React re-renders, so they add up on `live`, not on the last rendered value.
  const live = useRef(value);
  useEffect(() => {
    live.current = value;
  }, [value]);
  useWheel(face, (amount, notch) => {
    live.current = clamp(live.current + (notch ? amount * 0.02 : amount / DRAG_PX) * span);
    set(live.current);
  });
  // −1 … +1 for the indicator.
  const turn = ((value - min) / span) * 2 - 1;
  return (
    <span className="flex flex-col items-center gap-1" title={title}>
      <span
        ref={face}
        className="relative cursor-ns-resize touch-none overscroll-contain rounded-full focus-within:ring-2 focus-within:ring-white/60"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, from: value };
          (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus({ preventScroll: true });
        }}
        onPointerMove={(e) => {
          if (drag.current) set(drag.current.from + ((drag.current.y - e.clientY) / DRAG_PX) * span);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(reset)}
      >
        <span
          className="absolute inset-0 rounded-full border border-[#3a3a44] shadow-[inset_0_2px_3px_rgba(255,255,255,0.08),0_3px_6px_rgba(0,0,0,0.6)]"
          style={{ background: "radial-gradient(circle at 35% 30%, #34343c, #16161a 70%)" }}
        />
        {/* The auto-DJ's own move on this channel: a small dot on the ring. */}
        {auto && (
          <span ref={auto} className="pointer-events-none absolute -inset-[3px] block" style={{ transform: "rotate(0deg)" }} aria-hidden>
            <span className="absolute left-1/2 top-0 block h-1 w-1 -translate-x-1/2 rounded-full" style={{ background: color ?? "#f4f4f5", opacity: 0.85 }} />
          </span>
        )}
        <span className="pointer-events-none absolute inset-0 block" style={{ transform: `rotate(${turn * SWEEP}deg)` }} aria-hidden>
          <span className="absolute left-1/2 top-[8%] block h-[36%] w-[3px] -translate-x-1/2 rounded-full bg-[#f4f4f5]" />
        </span>
        <input
          id={id}
          type="range"
          min={Math.round(min * 100)}
          max={Math.round(max * 100)}
          step={1}
          value={Math.round(value * 100)}
          aria-label={name}
          aria-valuetext={valueText?.(value)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
      <label htmlFor={id} className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#9a9aa6]">
        {label}
      </label>
    </span>
  );
}

/** The master / headphone volume knob (0–100%). */
export function VolumeKnob({
  label,
  name = `${label} volume`,
  value,
  onChange,
  color,
  size = 44,
}: {
  label: string;
  name?: string;
  value: number;
  onChange: (volume: number) => void;
  color?: string;
  size?: number;
}) {
  const percent = Math.round(value * 100);
  return (
    <span className="flex flex-col items-center">
      <Knob label={label} name={name} value={value} min={0} max={1} reset={1} onChange={onChange} color={color} size={size} valueText={() => `${percent}%`} />
      <span className="font-mono text-[11px] text-foreground" aria-hidden>
        {percent}%
      </span>
    </span>
  );
}
