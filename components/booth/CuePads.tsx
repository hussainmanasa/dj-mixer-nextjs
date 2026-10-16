"use client";

import { barLabel, beatBar } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { HOT_CUES, type Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { padStyle } from "./theme";

export const PAD_LETTERS = "ABCDEFGH";

/**
 * Eight cue pads (hot cues A–H) for a deck's song, saved with the song — the
 * deck's HOT CUE pad mode. An empty pad saves the deck's spot (snapped to the
 * beat); a set pad goes there: on a playing song it jumps on the next beat, on a
 * loaded or cued deck it becomes the start point. Shift-click a pad, or use
 * Clear (`clearing`) then tap it, to empty it.
 */
export function CuePads({
  deck,
  track,
  color,
  disabled,
  clearing,
  onCleared,
  spot,
  onGo,
}: {
  deck: number;
  /** The song (null: no song — the pads show, disabled). */
  track: Track | null;
  color: string;
  disabled: boolean;
  /** Clear is on: a tap empties the pad. */
  clearing: boolean;
  onCleared: () => void;
  /** Where the deck is now (track seconds): what an empty pad saves. */
  spot: () => number | null;
  /** A set pad was pressed. */
  onGo: (position: number) => void;
}) {
  const setHotCue = useLibrary((s) => s.setHotCue);
  const a = track?.analysis ?? null;
  const pads = Array.from({ length: HOT_CUES }, (_, i) => track?.hotCues?.[i] ?? null);
  const letter = "ABCD"[deck];

  const press = (slot: number, shift: boolean) => {
    if (!track || !a) return;
    const at = pads[slot];
    if (at !== null && (clearing || shift)) {
      void setHotCue(track.id, slot, null);
      onCleared();
    } else if (at !== null) {
      onGo(at);
    } else {
      const pos = spot();
      // On the beat, so a jump to it lands in time.
      if (pos !== null) void setHotCue(track.id, slot, a.firstBeat + beatBar(a, pos) * barSeconds(a));
    }
  };

  return (
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Cue pads, Deck ${letter}`}>
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
            className="flex h-12 flex-col items-center justify-center rounded-md border text-sm font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={set ? padStyle(clearing ? "var(--bad)" : color) : padStyle(null)}
          >
            <span>{PAD_LETTERS[slot]}</span>
            <span className="font-mono text-[10px] font-normal leading-none">{set && a ? barLabel(beatBar(a, at)).replace("Bar ", "") : "+"}</span>
          </button>
        );
      })}
    </div>
  );
}
