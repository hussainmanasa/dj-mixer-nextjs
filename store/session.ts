"use client";

// Booth session: owns the single AutoDJ instance and mirrors its status for
// the UI. Staff can only change the mood and press play/stop.

import { create } from "zustand";
import { AutoDJ, type AutoDJStatus } from "@/lib/dj/autodj";
import { DEFAULT_MOOD } from "@/lib/dj/moods";
import { loadLastSession, saveLastSession } from "@/lib/library/store";
import type { MoodId } from "@/lib/types";
import { readyTracks, useLibrary } from "./library";

interface SessionState {
  status: AutoDJStatus;
  starting: boolean;
  /** The last session was playing when the page closed (crash / reboot). */
  resumeAvailable: boolean;

  hydrate: () => Promise<void>;
  play: () => Promise<void>;
  /** After a crash/reboot, try to resume without a click (works in kiosk mode). */
  tryAutoResume: () => Promise<void>;
  stop: () => Promise<void>;
  setMood: (mood: MoodId) => void;
  level: () => number;
  /** AudioContext time in seconds (0 when no engine). */
  clock: () => number;
}

let dj: AutoDJ | null = null;
let autoResumeTried = false;

const idle = (mood: MoodId, deckCount: number): AutoDJStatus => ({
  playing: false,
  mood,
  now: null,
  next: null,
  note: null,
  error: null,
  deckCount,
});

function persist(mood: MoodId, playing: boolean) {
  void saveLastSession({ mood, playing, updatedAt: Date.now() });
}

export const useSession = create<SessionState>((set, get) => ({
  status: idle(DEFAULT_MOOD, 2),
  starting: false,
  resumeAvailable: false,

  async hydrate() {
    const last = await loadLastSession();
    if (last) set({ status: { ...get().status, mood: last.mood }, resumeAvailable: last.playing });
  },

  async play() {
    if (get().starting || get().status.playing) return;
    set({ starting: true, resumeAvailable: false });
    try {
      const lib = useLibrary.getState();
      if (lib.folderState === "needs-permission" && !(await lib.reconnect())) {
        set({ status: { ...get().status, error: "Allow access to the music folder to start." } });
        return;
      }
      const { deckCount } = lib.settings;
      // Re-create the engine if the deck count setting changed.
      if (dj && dj.engine.decks.length !== deckCount) {
        await dj.dispose();
        dj = null;
      }
      dj ??= new AutoDJ(deckCount, get().status.mood, {
        getTracks: () => readyTracks(useLibrary.getState().tracks),
        getFile: (t) => useLibrary.getState().getFile(t),
        onTrackError: (id, msg) => useLibrary.getState().markError(id, msg),
        onStatus: (status) => set({ status }),
      });
      dj.setMood(get().status.mood);
      await dj.start();
      persist(get().status.mood, dj.isPlaying);
    } catch (err) {
      set({ status: { ...get().status, error: err instanceof Error ? err.message : String(err) } });
    } finally {
      set({ starting: false });
    }
  },

  async tryAutoResume() {
    if (autoResumeTried || !get().resumeAvailable) return;
    autoResumeTried = true;
    await get().play();
    // If the browser blocked audio, keep the banner so staff can press Play.
    if (!get().status.playing) set({ resumeAvailable: true });
  },

  async stop() {
    if (!dj) return;
    await dj.stop();
    persist(get().status.mood, false);
  },

  setMood(mood) {
    if (dj) dj.setMood(mood);
    else set({ status: { ...get().status, mood } });
    persist(mood, get().status.playing);
  },

  level() {
    return dj?.isPlaying ? dj.engine.level() : 0;
  },

  clock() {
    return dj?.engine.now ?? 0;
  },
}));
