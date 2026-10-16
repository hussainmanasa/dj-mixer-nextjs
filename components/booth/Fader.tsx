"use client";

import { useEffect, useId, useRef } from "react";
import { useWheel } from "./useWheel";

/**
 * A fader staff move: a channel fader (vertical, up = louder) or the crossfader (horizontal, left = Deck A).
 * Drag the cap or click anywhere on the track; click it and use the arrow keys; double-click goes back to
 * `reset`. A range input under it carries the value (keyboard, screen readers). `auto` (optional) is a tick beside
 * the track the frame loop moves — where the auto-DJ has this channel.
 */
export function Fader({
  name,
  value,
  onChange,
  reset,
  orientation,
  label,
  testId,
  auto,
  className = "",
}: {
  name: string;
  /** 0 … 1 (vertical: 1 = top; horizontal: 0 = left). */
  value: number;
  onChange: (value: number) => void;
  reset: number;
  orientation: "vertical" | "horizontal";
  label: string;
  testId?: string;
  auto?: React.Ref<HTMLSpanElement>;
  className?: string;
}) {
  const id = useId();
  const track = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const vertical = orientation === "vertical";
  // The cap covers this share of the track; its centre runs between the ends.
  const CAP = 0.18;
  const at = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const t = vertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width;
    onChange(Math.round(Math.max(0, Math.min(1, (t - CAP / 2) / (1 - CAP))) * 100) / 100);
  };
  const pos = `calc(${value * 100}% * ${1 - CAP})`;
  // Scroll / a trackpad swipe moves it (the page stays put): a swipe like a drag, a mouse-wheel click 5%.
  // (Swipe events add up on `live`: they come faster than React re-renders.)
  const live = useRef(value);
  useEffect(() => {
    live.current = value;
  }, [value]);
  useWheel(track, (amount, notch) => {
    live.current = Math.max(0, Math.min(1, live.current + (notch ? amount * 0.05 : amount / 160)));
    onChange(Math.round(live.current * 100) / 100);
  });
  return (
    <span className={`flex flex-col items-center gap-1 ${className}`}>
      <span
        ref={track}
        className={`relative block cursor-pointer touch-none rounded focus-within:ring-2 focus-within:ring-white/50 ${vertical ? "h-24 w-8" : "h-8 w-full"}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus({ preventScroll: true });
          at(e);
        }}
        onPointerMove={(e) => dragging.current && at(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onDoubleClick={() => onChange(reset)}
      >
        <span
          className={`absolute rounded-full bg-[#050506] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)] ${
            vertical ? "inset-y-1 left-1/2 w-1.5 -translate-x-1/2" : "inset-x-1 top-1/2 h-1.5 -translate-y-1/2"
          }`}
        />
        {auto && (
          <span
            ref={auto}
            aria-hidden
            className={`pointer-events-none absolute rounded-full bg-white/60 ${vertical ? "-right-1 h-0.5 w-1.5" : "-bottom-1 h-1.5 w-0.5"}`}
            style={vertical ? { bottom: 0 } : { left: 0 }}
          />
        )}
        <span
          data-testid={testId}
          aria-hidden
          className={`pointer-events-none absolute rounded-sm border border-[#4a4a54] bg-[linear-gradient(180deg,#3a3a42,#1c1c22)] shadow-[0_3px_5px_rgba(0,0,0,0.6)] ${
            vertical ? "left-0 h-[18%] w-8" : "top-0 h-8 w-[18%]"
          }`}
          style={vertical ? { bottom: pos } : { left: pos }}
        >
          <span className={`absolute bg-white/70 ${vertical ? "inset-x-1 top-1/2 h-px" : "inset-y-1 left-1/2 w-px"}`} />
        </span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          aria-label={name}
          aria-orientation={orientation}
          aria-valuetext={`${Math.round(value * 100)}%`}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
      <label htmlFor={id} className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9a9aa6]">
        {label}
      </label>
    </span>
  );
}
