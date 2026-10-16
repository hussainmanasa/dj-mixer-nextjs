"use client";

import { useState } from "react";
import { barLabel, beatBar } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { HOT_CUES, type Track } from "@/lib/types";
import { useLibrary } from "@/store/library";

export const PAD_LETTERS = "ABCDEFGH";

/**
 * Eight cue pads (hot cues A–H) for a deck's song, saved with the song. An
 * empty pad saves the deck's spot (snapped to the beat); a set pad goes there:
 * on the song on air it jumps on the next beat, on a loaded or cued deck it
 * becomes the start point. Shift-click a pad, or use Clear then tap it, to empty it.
 */
export function CuePads({
  deck,
  track,
  color,
  disabled,
  spot,
  onGo,
}: {
  deck: number;
  /** The song (null: no song — the pads show, disabled). */
  track: Track | null;
  color: string;
  /** The deck's mix is under way (or about to start): the pads wait. */
  disabled: boolean;
  /** Where the deck is now (track seconds): what an empty pad saves. */
  spot: () => number | null;
  /** A set pad was pressed. */
  onGo: (position: number) => void;
}) {
  const setHotCue = useLibrary((s) => s.setHotCue);
  const [clearing, setClearing] = useState(false);
  const a = track?.analysis ?? null;
  const pads = Array.from({ length: HOT_CUES }, (_, i) => track?.hotCues?.[i] ?? null);
  const letter = "ABCD"[deck];

  const press = (slot: number, shift: boolean) => {
    if (!track || !a) return;
    const at = pads[slot];
    if (at !== null && (clearing || shift)) {
      void setHotCue(track.id, slot, null);
      setClearing(false);
    } else if (at !== null) {
      onGo(at);
    } else {
      const pos = spot();
      // On the beat, so a jump to it lands in time.
      if (pos !== null) void setHotCue(track.id, slot, a.firstBeat + beatBar(a, pos) * barSeconds(a));
    }
  };

  return (
    <div className="mt-3" role="group" aria-label={`Cue pads, Deck ${letter}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Cue pads</span>
        <button
          type="button"
          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${clearing ? "border-bad text-bad" : "border-border text-muted hover:text-foreground"}`}
          aria-pressed={clearing}
          disabled={!track || !pads.some((p) => p !== null)}
          onClick={() => setClearing((c) => !c)}
          title="Then tap a pad to empty it (or Shift-click a pad)"
        >
          {clearing ? "Tap a pad to clear" : "Clear"}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {pads.map((at, slot) => {
          const set = at !== null;
          return (
            <button
              key={slot}
              type="button"
              disabled={!track || (disabled && !clearing)}
              onClick={(e) => press(slot, e.shiftKey)}
              aria-label={set && a ? `Cue ${PAD_LETTERS[slot]}, ${barLabel(beatBar(a, at))}, Deck ${letter}` : `Save cue ${PAD_LETTERS[slot]}, Deck ${letter}`}
              title={set ? (clearing ? "Clear this pad" : "Go here (Shift-click to clear)") : "Save the deck's spot here"}
              className="flex h-12 flex-col items-center justify-center rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
              style={
                set
                  ? clearing
                    ? { borderColor: "var(--bad)", background: "color-mix(in srgb, var(--bad) 18%, var(--surface))" }
                    : { borderColor: color, background: `color-mix(in srgb, ${color} 28%, var(--surface))` }
                  : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--muted)" }
              }
            >
              <span>{PAD_LETTERS[slot]}</span>
              <span className="font-mono text-[10px] font-normal leading-none">{set && a ? barLabel(beatBar(a, at)).replace("Bar ", "") : "+"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
