"use client";

// Booth session: owns the single AutoDJ instance and mirrors its status for
// the UI. Staff change the mood, press play/stop and Drop, fire effects and
// request tracks; the AutoDJ does all the mixing.

import { create } from "zustand";
import type { FxKind } from "@/lib/audio/fx";
import { AutoDJ, type AutoDJStatus, type BoothSnapshot, type Preload } from "@/lib/dj/autodj";
import { DEFAULT_MOOD, resolveMood, targetEnergy } from "@/lib/dj/moods";
import { rankForRequest, type RequestOption } from "@/lib/dj/selector";
import { appendSetLog, loadLastSession, saveLastSession, type Settings } from "@/lib/library/store";
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
  /** Layer: the cued song (or `trackId`) plays over the current one until Drop swaps them. */
  layer: (trackId?: string) => void;
  /** Songs loaded into decks before Play (index = deck). Deck A plays first, the others next in order. */
  preloads: (Preload | null)[];
  loadDeck: (deck: number, trackId: string) => void;
  ejectDeck: (deck: number) => void;
  /** "Start from" for a loaded deck: where Deck A starts, or how a later deck comes in. */
  setPreloadEntry: (deck: number, choice: EntryChoice) => void;
  /** Jog wheel on a loaded or cued deck: scratch its song on the club speakers (`step`: a short blip). */
  scratch: (track: Track, position: number, step: boolean) => void;
  scratchEnd: () => void;
  /** Master volume on the club speakers, 0..1 (saved in the settings). */
  setVolume: (volume: number) => void;
  /** ⏸ on a deck: pause the song on air (silence until ▶), or stop one side of a mix. */
  pauseDeck: (deck: number) => void;
  /** ▶ on a deck: resume the paused song, or bring the cued one in now. */
  playDeck: (deck: number) => void;
  /** A hand on the jog wheel of the song on air: it stops like a record (playing or paused). */
  grabDeck: (deck: number) => void;
  /** The hand lets go at `position`: a held song plays on from there, a paused one waits there for ▶. */
  releaseDeck: (deck: number, position: number) => void;
  /** A fast backward flick of the held song: spinback into the cued song (else it just plays on). */
  spinBack: (deck: number, position: number) => void;
  /** A deck's tempo slider (playback rate). */
  setDeckTempo: (deck: number, rate: number) => void;
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

/**
 * The AutoDJ (and its audio engine) for the current settings, created on first
 * use: Play, or a scratch before Play. Later setting changes reach it through
 * `applySettings`, also mid-set.
 */
async function ensureDj(
  set: (s: Partial<SessionState>) => void,
  get: () => SessionState,
): Promise<AutoDJ> {
  const { deckCount, keyLock, mainOutput, volume } = useLibrary.getState().settings;
  if (dj) return dj;
  const created = new AutoDJ(deckCount, get().status.mood, {
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
  dj = created;
  created.engine.setVolume(volume);
  // The mix goes to the club speakers chosen on the Library page.
  await created.engine.setOutput(mainOutput);
  return created;
}

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
  paused: null,
  holding: false,
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
      const { deckCount } = lib.settings;
      const dj = await ensureDj(set, get);
      dj.setMood(get().status.mood);
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

  pauseDeck(deck) {
    if (!dj || get().stopping || !dj.pauseDeck(deck)) return;
    // Paused, the set isn't "playing" for auto-resume: a reload stays silent.
    if (get().status.paused !== null) persist(get().status.mood, false, get().status.queue);
  },

  playDeck(deck) {
    if (!dj || get().stopping) return;
    const wasPaused = get().status.paused !== null;
    if (dj.playDeck(deck) && wasPaused) persist(get().status.mood, true, get().status.queue);
  },

  grabDeck(deck) {
    if (!dj || get().stopping) return;
    // Already paused: the wheel just moves the paused spot.
    if (get().status.paused === null) dj.pauseDeck(deck, true);
  },

  releaseDeck(deck, position) {
    if (!dj) return;
    dj.movePaused(position);
    if (get().status.holding) dj.playDeck(deck, 0.012);
  },

  spinBack(deck, position) {
    if (!dj) return;
    if (!get().status.holding || !dj.spinBack()) get().releaseDeck(deck, position);
  },

  setDeckTempo(deck, rate) {
    if (!dj || get().stopping) return;
    dj.setDeckTempo(deck, rate);
  },

  scratch(track, position, step) {
    if (get().starting || get().stopping) return;
    void ensureDj(set, get)
      .then((d) => d.scratch(track, position, step))
      .catch(() => undefined);
  },

  scratchEnd() {
    dj?.scratchEnd();
  },

  setVolume(volume) {
    // Applied to the mix by `applySettings`.
    useLibrary.getState().setVolume(volume);
  },

  setEntry(choice) {
    dj?.setEntry(choice);
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

/**
 * Settings apply as soon as they change — on the Library page, on the booth, or
 * in another tab (store/library.ts syncs them) — with no reload and no Stop:
 * club volume and output at once, key-lock with a short crossfade on every deck,
 * the deck count as soon as decks are free. Moods are read at every decision.
 */
function applySettings(next: Settings, prev: Settings) {
  if (!dj) return;
  if (next.volume !== prev.volume) dj.engine.setVolume(next.volume);
  if (next.mainOutput !== prev.mainOutput) void dj.engine.setOutput(next.mainOutput);
  if (next.keyLock !== prev.keyLock) void dj.setKeyLock(next.keyLock);
  if (next.deckCount !== prev.deckCount) dj.setDeckCount(next.deckCount);
}

useLibrary.subscribe((state, prev) => {
  if (state.settings !== prev.settings) applySettings(state.settings, prev.settings);
});
