"use client";

// Booth session: owns the single AutoDJ instance and mirrors its status for
// the UI. Staff change the mood, press play/stop and Drop, fire effects and
// request tracks; the AutoDJ does all the mixing.

import { create } from "zustand";
import type { FxKind } from "@/lib/audio/fx";
import { AutoDJ, type AutoDJStatus, type BoothSnapshot, type Preload } from "@/lib/dj/autodj";
import { DEFAULT_MOOD, resolveMood, targetEnergy } from "@/lib/dj/moods";
import { rankForRequest, type RequestOption } from "@/lib/dj/selector";
import { appendSetLog, loadLastSession, saveLastSession } from "@/lib/library/store";
import type { EntryChoice, MoodId, Track } from "@/lib/types";
import { readyTracks, useLibrary } from "./library";
import { usePreview } from "./preview";

interface SessionState {
  status: AutoDJStatus;
  starting: boolean;
  /** Stop was pressed and the mix is fading out (the button stays disabled until it's silent). */
  stopping: boolean;
  /** The last session was playing when the page closed (crash / reboot). */
  resumeAvailable: boolean;

  hydrate: () => Promise<void>;
  play: () => Promise<void>;
  /** After a crash/reboot, try to resume without a click (works in kiosk mode). */
  tryAutoResume: () => Promise<void>;
  stop: () => Promise<void>;
  setMood: (mood: MoodId) => void;
  /** Bring the next track in on its drop at the next 4-bar boundary. */
  drop: () => void;
  /** Booth "Start from": where the cued song comes in. */
  setEntry: (choice: EntryChoice) => void;
  /** Move the playing mix to the chosen club-speaker output (after it changes on the Library page). */
  applyOutput: () => Promise<void>;
  /** Layer: the cued song (or `trackId`) plays over the current one until Drop swaps them. */
  layer: (trackId?: string) => void;
  /** Songs loaded into decks before Play (index = deck). Deck A plays first, the others next in order. */
  preloads: (Preload | null)[];
  loadDeck: (deck: number, trackId: string) => void;
  ejectDeck: (deck: number) => void;
  /** "Start from" for a loaded deck: where Deck A starts, or how a later deck comes in. */
  setPreloadEntry: (deck: number, choice: EntryChoice) => void;
  /** Fire an effect on the whole mix, on the next beat. */
  fx: (kind: FxKind) => void;
  /** Staff request: `next` replaces the cued track, otherwise it joins the queue. */
  request: (trackId: string, next: boolean) => void;
  unrequest: (trackId: string) => void;
  /** Tracks for the picker, best fit for the mood (and the playing track) first. */
  rankTracks: () => RequestOption[];
  level: () => number;
  /** AudioContext time in seconds (0 when no engine). */
  clock: () => number;
  /** Live deck positions and levels for the booth display (null when stopped). */
  snapshot: () => BoothSnapshot | null;
}

let dj: AutoDJ | null = null;
let autoResumeTried = false;

const idle = (mood: MoodId, deckCount: number): AutoDJStatus => ({
  playing: false,
  mood,
  now: null,
  next: null,
  standby: null,
  queue: [],
  keyLock: false,
  note: null,
  error: null,
  deckCount,
});

let lastQueueKey = "";

function persist(mood: MoodId, playing: boolean, queue: Track[]) {
  lastQueueKey = queue.map((t) => t.id).join(",");
  void saveLastSession({ mood, playing, queue: queue.map((t) => t.id), updatedAt: Date.now() });
}

export const useSession = create<SessionState>((set, get) => ({
  status: idle(DEFAULT_MOOD, 2),
  starting: false,
  stopping: false,
  preloads: [],
  resumeAvailable: false,

  async hydrate() {
    const last = await loadLastSession();
    if (!last) return;
    // Requested tracks survive a reload; tracks that are gone or not ready are dropped.
    const lib = useLibrary.getState();
    if (!lib.hydrated) await lib.hydrate();
    const tracks = useLibrary.getState().tracks;
    const queue = (last.queue ?? []).map((id) => tracks[id]).filter((t) => t?.status === "ready" && t.analysis);
    lastQueueKey = queue.map((t) => t.id).join(",");
    set({ status: { ...get().status, mood: last.mood, queue: dj ? get().status.queue : queue }, resumeAvailable: last.playing });
  },

  async play() {
    if (get().starting || get().stopping || get().status.playing) return;
    set({ starting: true, resumeAvailable: false });
    // A cue on a loaded deck ends when the set starts (that song is about to play on the club speakers).
    if (usePreview.getState().playing?.startsWith("cue:")) usePreview.getState().stop();
    try {
      const lib = useLibrary.getState();
      if (lib.folderState === "needs-permission" && !(await lib.reconnect())) {
        set({ status: { ...get().status, error: "Allow access to the music folder to start." } });
        return;
      }
      const { deckCount, keyLock } = lib.settings;
      // Re-create the engine if the deck count or key-lock setting changed.
      if (dj && (dj.engine.decks.length !== deckCount || dj.keyLock !== keyLock)) {
        await dj.dispose();
        dj = null;
      }
      dj ??= new AutoDJ(deckCount, get().status.mood, {
        getTracks: () => readyTracks(useLibrary.getState().tracks),
        getFile: (t) => useLibrary.getState().getFile(t),
        onTrackError: (id, msg) => useLibrary.getState().markError(id, msg),
        resolveMood: (id) => resolveMood(id, useLibrary.getState().settings.moods),
        onStatus: (status) => {
          set({ status });
          // Save the queue whenever it changes so a reload can restore it.
          if (status.queue.map((t) => t.id).join(",") !== lastQueueKey) persist(status.mood, status.playing, status.queue);
        },
        onPlayed: (t, how, requested, mood) =>
          void appendSetLog({
            at: Date.now(),
            trackId: t.id,
            title: t.title,
            artist: t.artist,
            path: t.path.replace(/^session:/, ""),
            mood,
            how,
            requested,
            bpm: t.analysis?.bpm ?? 0,
            key: t.camelot,
            duration: t.analysis?.duration ?? 0,
          }),
      }, keyLock);
      dj.setMood(get().status.mood);
      // The mix goes to the club speakers chosen on the Library page.
      await dj.engine.setOutput(lib.settings.mainOutput);
      // Requests made before the first Play.
      for (const t of get().status.queue) dj.request(t, false);
      // Decks loaded before Play: Deck A first, then the others in deck order.
      const loaded = get().preloads.slice(0, deckCount);
      const preset = { first: loaded[0] ?? undefined, next: loaded.slice(1).filter((p): p is Preload => !!p) };
      await dj.start(preset);
      if (dj.isPlaying) set({ preloads: [] });
      persist(get().status.mood, dj.isPlaying, get().status.queue);
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
    // A second press during the fade-out must not restart (or re-stop) the music.
    if (!dj || get().stopping || get().starting) return;
    set({ stopping: true });
    try {
      await dj.stop();
      persist(get().status.mood, false, get().status.queue);
    } finally {
      set({ stopping: false });
    }
  },

  setMood(mood) {
    if (dj) dj.setMood(mood);
    else set({ status: { ...get().status, mood } });
    persist(mood, get().status.playing, get().status.queue);
  },

  drop() {
    dj?.drop();
  },

  fx(kind) {
    dj?.fx(kind);
  },

  setEntry(choice) {
    dj?.setEntry(choice);
  },

  async applyOutput() {
    if (dj) await dj.engine.setOutput(useLibrary.getState().settings.mainOutput);
  },

  layer(trackId) {
    const track = trackId ? useLibrary.getState().tracks[trackId] : undefined;
    dj?.layer(track);
  },

  loadDeck(deck, trackId) {
    const track = useLibrary.getState().tracks[trackId];
    if (!track?.analysis) return;
    // A song sits on one deck at a time.
    const preloads = get().preloads.map((p) => (p?.track.id === trackId ? null : p));
    preloads[deck] = { track, entry: { kind: "auto" } };
    set({ preloads });
  },

  ejectDeck(deck) {
    const preloads = [...get().preloads];
    preloads[deck] = null;
    set({ preloads });
  },

  setPreloadEntry(deck, choice) {
    const p = get().preloads[deck];
    if (!p) return;
    const preloads = [...get().preloads];
    preloads[deck] = { ...p, entry: choice };
    set({ preloads });
  },

  request(trackId, next) {
    const track = useLibrary.getState().tracks[trackId];
    if (!track) return;
    if (dj) return dj.request(track, next);
    const queue = get().status.queue.filter((t) => t.id !== trackId);
    set({ status: { ...get().status, queue: next ? [track, ...queue] : [...queue, track] } });
    persist(get().status.mood, false, get().status.queue);
  },

  unrequest(trackId) {
    if (dj) return dj.unrequest(trackId);
    set({ status: { ...get().status, queue: get().status.queue.filter((t) => t.id !== trackId) } });
    persist(get().status.mood, false, get().status.queue);
  },

  rankTracks() {
    const tracks = readyTracks(useLibrary.getState().tracks);
    if (dj) return dj.rankTracks(tracks);
    const mood = resolveMood(get().status.mood, useLibrary.getState().settings.moods);
    const queued = new Set(get().status.queue.map((t) => t.id));
    return rankForRequest(tracks.filter((t) => !queued.has(t.id)), {
      mood,
      current: null,
      currentBpm: null,
      targetEnergy: targetEnergy(mood, 0),
      history: [],
      recentArtists: [],
      jump: false,
    });
  },

  level() {
    return dj?.isPlaying ? dj.engine.level() : 0;
  },

  clock() {
    return dj?.engine.now ?? 0;
  },

  snapshot() {
    return dj?.isPlaying ? dj.snapshot() : null;
  },
}));
