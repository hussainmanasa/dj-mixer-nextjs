"use client";

import { useRef } from "react";
import { FX_KINDS, type FxKind } from "@/lib/audio/fx";
import { useSession } from "@/store/session";
import { setText, useBoothFrame } from "./frame";

const FX_LABEL: Record<FxKind, { name: string; hint: string }> = {
  echo: { name: "Echo", hint: "Echo the next beat" },
  filter: { name: "Filter", hint: "One-bar low-pass dip" },
  reverb: { name: "Reverb", hint: "Reverb swell for a bar" },
  riser: { name: "Riser", hint: "4-bar noise riser into the next downbeat" },
};

/**
 * Effects on the whole mix, timed by the auto-DJ to the live deck's beat.
 * A button lights while its effect sounds — fired by staff, or by the
 * auto-DJ on a transition (moods with "Add effects on transitions").
 */
export function FxPad({ enabled, color }: { enabled: boolean; color: string }) {
  const fx = useSession((s) => s.fx);
  const glows = useRef<Partial<Record<FxKind, HTMLSpanElement | null>>>({});
  const buttons = useRef<Partial<Record<FxKind, HTMLButtonElement | null>>>({});
  const auto = useRef<HTMLSpanElement>(null);

  useBoothFrame((snap) => {
    const active = snap?.activeFx ?? [];
    for (const kind of FX_KINDS) {
      const on = active.some((f) => f.kind === kind);
      const glow = glows.current[kind];
      if (glow) glow.style.opacity = on ? "1" : "0";
      buttons.current[kind]?.setAttribute("data-active", on ? "true" : "false");
    }
    setText(auto.current, active.some((f) => f.auto) ? "· auto" : "");
  });

  return (
    <div className="w-full">
      <h3 className="mb-2 text-center text-xs font-medium uppercase tracking-wider text-muted">
        Effects <span ref={auto} style={{ color }} />
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {FX_KINDS.map((kind) => (
          <button
            key={kind}
            ref={(el) => {
              buttons.current[kind] = el;
            }}
            type="button"
            disabled={!enabled}
            title={FX_LABEL[kind].hint}
            onClick={() => fx(kind)}
            className="relative h-14 overflow-hidden rounded-xl border border-border bg-surface-2 text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <span
              ref={(el) => {
                glows.current[kind] = el;
              }}
              aria-hidden
              className="absolute inset-0 transition-opacity duration-150"
              style={{ background: `color-mix(in srgb, ${color} 55%, transparent)`, opacity: 0 }}
            />
            <span className="relative">{FX_LABEL[kind].name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
