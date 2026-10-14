"use client";

// The shared preview player as a store: the track editor, the booth's Cue and
// the picker's preview all use it, so only one preview plays at a time. It
// plays on the preview / cue output (see lib/library/preview.ts).

import { create } from "zustand";
import { sharedPreview, type GridPreview } from "@/lib/library/preview";

interface PreviewState {
  /** What is playing (a tag such as "grid", "cue:0", "pick:<id>"), only once audio has started. */
  playing: string | null;
  /** A song is being loaded for a preview. */
  loading: boolean;
  error: string | null;
  play: (tag: string, run: (p: GridPreview) => Promise<void>) => Promise<void>;
  stop: () => void;
  /** Current track position of the playhead, or null. */
  position: () => number | null;
}

export const usePreview = create<PreviewState>((set) => ({
  playing: null,
  loading: false,
  error: null,

  async play(tag, run) {
    set({ error: null, playing: null, loading: true });
    sharedPreview.onEnded = () => set({ playing: null });
    try {
      // Decoding a song takes a moment: only report "playing" once it has started.
      await run(sharedPreview);
      set({ playing: tag });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not play the track" });
    } finally {
      set({ loading: false });
    }
  },

  stop() {
    sharedPreview.stop();
    set({ playing: null });
  },

  position: () => sharedPreview.position(),
}));
