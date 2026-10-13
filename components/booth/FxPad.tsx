"use client";

import { useState } from "react";
import { FX_KINDS, type FxKind } from "@/lib/audio/fx";
import { useSession } from "@/store/session";

const FX_LABEL: Record<FxKind, { name: string; hint: string }> = {
  echo: { name: "Echo", hint: "Echo the next beat" },
  filter: { name: "Filter", hint: "One-bar low-pass dip" },
  reverb: { name: "Reverb", hint: "Reverb swell for a bar" },
  riser: { name: "Riser", hint: "4-bar noise riser into the next downbeat" },
};

/** Effects on the whole mix, timed by the auto-DJ to the live deck's beat. */
export function FxPad({ enabled, color }: { enabled: boolean; color: string }) {
  const fx = useSession((s) => s.fx);
  const [lit, setLit] = useState<FxKind | null>(null);
  return (
    <div className="w-full">
      <h3 className="mb-2 text-center text-xs font-medium uppercase tracking-wider text-muted">Effects</h3>
      <div className="grid grid-cols-4 gap-2">
        {FX_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={!enabled}
            title={FX_LABEL[kind].hint}
            onClick={() => {
              fx(kind);
              setLit(kind);
              // Display only: the effect itself is scheduled on the audio clock.
              setTimeout(() => setLit((k) => (k === kind ? null : k)), 1200);
            }}
            className="h-14 rounded-xl border text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
            style={
              lit === kind
                ? { borderColor: color, background: color, color: "#07070b" }
                : { borderColor: "var(--border)", background: "var(--surface-2)" }
            }
          >
            {FX_LABEL[kind].name}
          </button>
        ))}
      </div>
    </div>
  );
}
