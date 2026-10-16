"use client";

import { useId, useRef } from "react";

/** Knob sweep: −135° (min) … +135° (max), like a mixer's rotary. */
const SWEEP = 135;

/** Point a knob's indicator at `v` (−1 … +1, 0 = centre). For display knobs, from the frame loop. */
export function setKnob(el: HTMLElement | null, v: number): void {
  if (el) el.style.transform = `rotate(${Math.max(-1, Math.min(1, v)) * SWEEP}deg)`;
}

/** The knob's face: a dark cap with a white indicator line (rotated through `indicator`). */
function Face({ indicator, size, color, initial }: { indicator?: React.Ref<HTMLSpanElement>; size: number; color?: string; initial: number }) {
  return (
    <span
      className="relative block rounded-full border border-[#3a3a44] shadow-[inset_0_2px_3px_rgba(255,255,255,0.08),0_3px_6px_rgba(0,0,0,0.6)]"
      style={{ width: size, height: size, background: "radial-gradient(circle at 35% 30%, #34343c, #16161a 70%)" }}
    >
      <span
        ref={indicator}
        className="absolute inset-0 block"
        style={{ transform: `rotate(${initial * SWEEP}deg)` }}
      >
        <span className="absolute left-1/2 top-[8%] block h-[36%] w-[3px] -translate-x-1/2 rounded-full" style={{ background: color ?? "#f4f4f5" }} />
      </span>
    </span>
  );
}

/**
 * A knob that only shows a value the auto-DJ sets (EQ, trim, colour FX): the booth never lets staff turn it
 * (owner decision 2 — no manual EQ). Its indicator is turned with `setKnob` from the frame loop.
 */
export function DisplayKnob({
  label,
  indicator,
  size = 30,
  title,
}: {
  label: string;
  indicator: React.Ref<HTMLSpanElement>;
  size?: number;
  title?: string;
}) {
  return (
    <span className="flex flex-col items-center gap-1" title={title ?? `${label} — set by the auto-DJ`} aria-hidden>
      <Face indicator={indicator} size={size} initial={0} />
      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#9a9aa6]">{label}</span>
    </span>
  );
}

/**
 * A knob staff turn (the master and headphone volumes): drag up / down, scroll, or the arrow keys. A range
 * input under the face carries the value, so it works with the keyboard and screen readers like a slider.
 */
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
  const id = useId();
  const drag = useRef<{ y: number; from: number } | null>(null);
  const percent = Math.round(value * 100);
  const set = (v: number) => onChange(Math.max(0, Math.min(100, Math.round(v))) / 100);
  return (
    <span className="flex flex-col items-center gap-1">
      <span
        className="relative cursor-ns-resize touch-none rounded-full focus-within:ring-2 focus-within:ring-white/60"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, from: percent };
          (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus();
        }}
        onPointerMove={(e) => {
          if (drag.current) set(drag.current.from + (drag.current.y - e.clientY) * 0.6);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => set(percent + (e.deltaY < 0 ? 2 : -2))}
      >
        <Face size={size} color={color} initial={value * 2 - 1} />
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-label={name}
          aria-valuetext={`${percent}%`}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
      <label htmlFor={id} className="text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.16em] text-[#9a9aa6]">
        {label}
        <span className="block font-mono text-[11px] normal-case tracking-normal text-foreground">{percent}%</span>
      </label>
    </span>
  );
}
