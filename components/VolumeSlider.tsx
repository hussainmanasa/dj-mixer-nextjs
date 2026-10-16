"use client";

import { useId } from "react";

/** A volume slider (0..1 shown as 0–100%): the club speakers' or the headphones'. */
export function VolumeSlider({
  label,
  name = `${label} volume`,
  value,
  onChange,
  color,
  warning,
}: {
  /** Visible label, e.g. "Club speakers". */
  label: string;
  /** The slider's accessible name (default "<label> volume"). */
  name?: string;
  value: number;
  onChange: (volume: number) => void;
  color?: string;
  /** Shown under the slider when the volume is at 0. */
  warning?: string;
}) {
  const id = useId();
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-muted">
        {label}
        <span className="font-mono text-base text-foreground" aria-hidden>
          {percent}%
        </span>
      </label>
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
        className="h-10 w-full cursor-pointer"
        style={color ? { accentColor: color } : undefined}
      />
      {/* Its space is kept, so nothing moves when it shows. */}
      {warning !== undefined && (
        <p className="min-h-[1.25rem] text-center text-sm text-warn" style={{ visibility: percent === 0 && warning ? "visible" : "hidden" }}>
          {warning || " "}
        </p>
      )}
    </div>
  );
}
