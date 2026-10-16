// The auto-DJ: picks every track, schedules every transition and recovers from
// failures with no human input. Staff pick the mood and press play/stop, and
// may also press Drop, fire an effect, or request tracks; the auto-DJ still
// beat-matches and times every request to the mood. Client-only (owns the AudioEngine).
//
// Timing model: all audio events are scheduled ahead on the AudioContext
// clock (sample-accurate). JS timers are only used to *plan* the next step
// and to hand over between decks after a transition has finished, so timer
// jitter never reaches the audio.

import { AudioEngine } from "@/lib/audio/engine";
import { REWIND_SECONDS, type Deck } from "@/lib/audio/deck";
import type { MixerChannel } from "@/lib/audio/mixer";
import type { FxKind } from "@/lib/audio/fx";
import { libraryLoudness } from "@/lib/analysis/loudness";
import {
  blend,
  cut,
  dialogueIn,
  dropIn,
  echoOut,
  filterSweep,
  layerSwap,
  REWIND_LEAD,
  rewindInto,
  type TransitionPlan,
} from "@/lib/audio/transitions";
import { MAX_DECKS, MIN_DECKS, type EntryChoice, type Mood, type MoodId, type Track, type TransitionKind } from "@/lib/types";
import { defaultStart, firstStart, openerWindow, resolveEntry, type FirstStart } from "./cues";
import { getMood, targetEnergy } from "./moods";
import { drops } from "@/lib/analysis/structure";
import { barSeconds, BEATS_PER_BAR, dropBuildBars, gridPosition, mixOutFor, nextBoundary, nextDownbeat } from "./mixpoints";
import {
  chooseTransition,
  isMoodJump,
  MIN_BLEND_CONFIDENCE,
  pickNext,
  pickOpener,
  rankForRequest,
  syncRatio,
  type RequestOption,
  type SelectionContext,
} from "./selector";

/** Stop fades the whole mix out over this many seconds. */
export const STOP_FADE_SECONDS = 2;
/** Seconds of lead time we need to schedule a transition safely. */
export const SCHEDULE_MARGIN = 2;
/** A Drop lands on the next boundary of this many bars, so it stays in phrase. */
const DROP_BOUNDARY_BARS = 4;
/** The incoming track rises in over at least / at most this many bars before its drop. */
const MIN_DROP_BUILD_BARS = 2;
const MAX_DROP_BUILD_BARS = 8;
/** Bars over which an incoming deck's tempo glides back to its native rate. */
const TEMPO_HANDBACK_BARS = 16;
/** Master peak below this for SILENCE_SECONDS triggers recovery. */
const SILENCE_LEVEL = 0.0005;
const SILENCE_SECONDS = 2;
const START_GRACE_SECONDS = 6;
/** Pausing a deck fades it out this fast (no click); resuming fades in over RESUME_FADE. */
const PAUSE_FADE = 0.06;
/** Switching key-lock mid-set crossfades each deck to its new route over this long. */
const KEYLOCK_SWITCH_FADE = 0.04;
const RESUME_FADE = 0.3;
/** A hand on the jog wheel of the song on air stops it (and letting go starts it) this fast, like a record. */
const HOLD_FADE = 0.012;
/** An ejected deck stays empty until this long (s) before the song on air ends; then the auto-DJ fills it. */
const EJECT_REFILL_SECONDS = 30;
/** Staff's fader / crossfader below this gain on the song on air: a deliberate silence (the watchdog waits). */
const STAFF_MUTED = 0.03;
/** CUE on a stopped deck within this of its cue point (seconds) plays it; further away, it sets a new one. */
const CUE_SNAP = 0.02;
/** Staff's tempo slider: at most this far from a song's own tempo (the same ±8% the auto-DJ syncs within). */
export const MAX_TEMPO = 0.08;
/** A held transition (the cued song while the set is paused) has no time yet. */
const HELD_PLAN: TransitionPlan = { kind: "cut", start: Infinity, end: Infinity };

export interface NowPlaying {
  track: Track;
  deck: number;
  bpm: number;
  startedAt: number;
}

export interface UpNext {
  track: Track;
  deck: number;
  transition: TransitionKind;
  /** Context time the transition starts. */
  at: number;
  /** Staff chose this track. */
  requested: boolean;
  /** How staff want it to come in (booth "Start from"). */
  entry: EntryChoice;
  /** Track position it starts playing from (a dialogue's start when it has one). */
  startAt: number;
  /** Desi Night: this mix only happens on Drop (or by itself near the end of the song). */
  holding: boolean;
  /** Staff's tempo for it after its mix (playback rate), or null for its own tempo. */
  tempo: number | null;
  /** ▶ Play now: playing together with the song on air, until Drop or one of them ends. */
  together: { swapAt: number | null } | null;
  /** AI DJ off: it starts the moment the song on air ends (no mix). */
  afterSong: boolean;
}

export interface Standby {
  track: Track;
  deck: number;
}

export interface AutoDJStatus {
  playing: boolean;
  mood: MoodId;
  now: NowPlaying | null;
  next: UpNext | null;
  standby: Standby | null;
  /** Tracks staff requested, in the order they'll play (after `next`). */
  queue: Track[];
  note: string | null;
  error: string | null;
  deckCount: number;
  /** Key-lock is actually running (requested in settings and the worklet loaded). */
  keyLock: boolean;
  /** Staff paused the song on air (this deck): the club hears nothing until ▶. */
  paused: number | null;
  /** A hand is on this deck's jog wheel (a scratch): it stopped, and plays on when let go. */
  holding: number | null;
  /** The song playing along (a pair's other deck) is paused on this deck. */
  pausedAlong: number | null;
  /** Nothing is playing: the song on air is paused and no other song is sounding. */
  silent: boolean;
  /**
   * Loops: playing on a deck (the song on air — the cued mix waits for it — or the song playing along), or
   * `armed` on a stopped song (it loops from there once it plays). `beats` is null for a saved loop.
   */
  loops: { deck: number; beats: number | null; start: number; end: number; armed: boolean }[];
  /** Each deck's cue point (track seconds; null without a song): CUE goes back to it. */
  cuePoints: (number | null)[];
  /** CUE is held on this deck: it plays from the cue point until let go. */
  cueHeld: number | null;
  /** AI DJ mode: on, the auto-DJ mixes songs nobody has touched; off, it never mixes by itself (each song plays to its end). */
  auto: boolean;
}

/** What one deck is doing right now, read every animation frame by the booth display. */
export interface DeckView {
  /** False while the deck is cued for a scheduled start. */
  started: boolean;
  /** Context time (as heard) the deck starts or started playing. */
  startsAt: number;
  /** Track position (s). */
  position: number;
  /** Current playback rate (1 = native tempo). */
  rate: number;
  /** Current fader level, 0..1. */
  fader: number;
  /** Current low-EQ gain in dB (0 = full bass, EQ_KILL_DB = killed). */
  bassDb: number;
  /** Current mid and high EQ gains (dB) and the volume-matching trim (dB) — the mixer's knobs show them. */
  midDb: number;
  highDb: number;
  trimDb: number;
  /** Colour FX position, −1 (low-pass) … 0 (open) … +1 (high-pass). */
  cfx: number;
  /** Channel level after the fader (peak, 0..1+). */
  level: number;
}

/** A deck loaded before Play: its song and how it should start / come in. */
export interface Preload {
  track: Track;
  entry: EntryChoice;
}

/** What staff loaded before Play: Deck A plays first, the rest come in order after it. */
export interface StartPreset {
  first?: Preload;
  /** The deck `first` plays on (default Deck A): staff pressed ▶ on that deck before the set. */
  firstDeck?: number;
  next: Preload[];
}

export interface BoothSnapshot {
  /** AudioContext time. */
  now: number;
  decks: (DeckView | null)[];
  /** The planned transition, in context time (`drop`: when a Drop hits). */
  mix: { start: number; end: number; drop?: number } | null;
  /** Track position on the live deck where the next transition starts. */
  mixOutPosition: number | null;
  /** The live deck is still playing a dialogue before its drop: Drop waits. */
  dropLocked: boolean;
  /** Effects sounding right now, and whether the auto-DJ fired them. */
  activeFx: { kind: FxKind; auto: boolean }[];
  /** Two songs are layered and waiting for Drop to swap them. */
  layering: boolean;
  /** Loops playing or armed (track seconds), per deck. */
  loops: { deck: number; start: number; end: number; armed: boolean }[];
}

export interface AutoDJDeps {
  getTracks: () => Track[];
  getFile: (track: Track) => Promise<File>;
  onTrackError: (trackId: string, message: string) => void;
  onStatus: (status: AutoDJStatus) => void;
  /** The mood preset with the admin's edits (default: the built-in preset). Read fresh at every decision. */
  resolveMood?: (id: MoodId) => Mood;
  /** A track started playing (for the set log). */
  onPlayed?: (track: Track, how: TransitionKind | "start" | "recovery", requested: boolean, mood: MoodId) => void;
}

interface Planned {
  deck: Deck;
  track: Track;
  plan: TransitionPlan;
  timer: ReturnType<typeof setTimeout>;
  requested: boolean;
  /** Staff pressed Drop for this one (an automatic drop swap can still be pulled forward). */
  staffDrop: boolean;
  entry: EntryChoice;
  startAt: number;
  holding: boolean;
  /** The auto-DJ scheduled effects for this transition (cancelled if it's re-planned). */
  fx: boolean;
  /** A layer (staff pressed Layer): it plays over the current song until Drop swaps them. */
  layer?: {
    rate: number;
    /** ▶ Play now: the two songs play together until the new one's drop (`swapAt`, context time) or Drop. */
    together?: boolean;
    /** The song playing along is at full level (playing together: always). */
    incFull?: boolean;
    /** Playing together: when the song playing along reaches its end (it then stops; the song on air plays on). */
    endTimer?: ReturnType<typeof setTimeout>;
    swapAt?: number;
    /** Context time to swap by at the latest (before either song runs out). */
    safety?: number;
  };
  /** The set is paused: the song is loaded on its deck but nothing is scheduled (`plan` is HELD_PLAN). */
  held?: boolean;
  /** Staff paused this song during its mix: it comes in again near the end of the current song. */
  deferred?: boolean;
  /** Staff's tempo slider on the cued deck: the playback rate it settles at after its mix (else 1). */
  tempo?: number;
  /** No automatic mix (AI DJ off, or staff touched one of the songs): it starts when the song on air ends. */
  manual?: boolean;
  /** Staff played, paused or cued this song: the auto-DJ leaves it alone (no automatic mix in or out). */
  touched?: boolean;
}

/** A next song taken back from its deck (`unplan`), to be planned again. */
interface Unplanned {
  track: Track;
  buffer: AudioBuffer;
  requested: boolean;
  entry: EntryChoice;
  deferred?: boolean;
  tempo?: number;
  touched?: boolean;
}

/** How `schedule` times a transition. */
interface ScheduleOptions {
  /** Staff pressed ▶ on the cued deck: mix it in on the next phrase. */
  soon?: boolean;
  /** Near the end of the current song (after staff paused this one's mix). */
  deferred?: boolean;
  /** The rate it settles at after its mix (staff's tempo slider), else its own tempo. */
  tempo?: number;
  /** Staff cued this song: no automatic mix — it starts when the song on air ends (or on ▶ / Drop). */
  touched?: boolean;
}

/** Where a song starts playing for a "Start from" choice (a dialogue's start when it has one). */
function startOf(track: Track, entry: EntryChoice): number {
  if (entry.kind === "auto") return defaultStart(track);
  const e = resolveEntry(track, entry);
  return e.dialogue?.start ?? e.land;
}

interface Loaded {
  track: Track;
  buffer: AudioBuffer;
  requested: boolean;
}

export class AutoDJ {
  readonly engine: AudioEngine;
  private readonly deps: AutoDJDeps;
  private moodKey: MoodId;
  private playing = false;
  /** The song on air. `from`: where it started (its cue point until CUE sets one). `touched`: staff played,
   *  paused or cued it — the auto-DJ doesn't mix out of it (it plays to its end, then the next song starts). */
  private current: { deck: Deck; track: Track; startedAt: number; from: number; touched?: boolean } | null = null;
  private planned: Planned | null = null;
  private standby: { deck: Deck; track: Track } | null = null;
  private history: string[] = [];
  private recentArtists: string[] = [];
  private moodTrackIndex = 0;
  private jump = false;
  private moodTracksLeft = 0;
  private note: string | null = null;
  private error: string | null = null;
  private failed = new Set<string>();
  /** Bumped whenever in-flight async planning must be discarded. */
  private generation = 0;
  /** Staff pressed Drop and the next transition hasn't been scheduled as one yet. */
  private dropRequested = false;
  /** Tracks staff requested; they play before the auto-DJ's own picks. */
  private requests: Track[] = [];
  /** How a queued track should come in (decks loaded before Play keep their "Start from"). */
  private requestEntries = new Map<string, EntryChoice>();
  /** Effects scheduled or sounding, in master (context) time, for the booth's FX pad. */
  private fxWindows: { kind: FxKind; start: number; end: number; auto: boolean }[] = [];
  /** While the set opener plays: the track position where it auto-drops into the party. */
  private openerEnd: number | null = null;
  private planning = false;
  private recovering = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Staff paused the live deck: where its song stopped. */
  /** `jump`: a dialogue still to play from track position `from`, then on from `to` (its drop). `hold`: a hand on the jog wheel. */
  private paused: { deck: Deck; position: number; rate: number; jump?: { from: number; to: number }; hold: boolean } | null = null;
  /** Loops playing, per deck (track seconds; `beats` null for a saved loop). */
  private loops = new Map<Deck, { start: number; end: number; beats: number | null }>();
  /** Loops armed on stopped songs (paused, or cued), by track id: they start looping when the song plays. */
  private armed = new Map<string, { start: number; end: number; beats: number | null }>();
  /** Cue points set with CUE (track seconds), per deck; a different song on the deck has its own. */
  private cuePoints = new Map<Deck, { trackId: string; at: number }>();
  /** Staff ejected the next song: the auto-DJ leaves its deck empty until LOAD, or until the song on air nears its end. */
  private ejectHold: ReturnType<typeof setInterval> | null = null;
  /** CUE is held on this deck: it plays from the cue point `at` until let go (`cued`: it was the cued song). */
  private cueHeld: { deck: Deck; at: number; cued: boolean } | null = null;
  /** AI DJ mode (see AutoDJStatus.auto). */
  private auto = true;
  /** The song playing along (a pair's second deck) paused by staff: where it stopped. */
  private pausedAlong: { position: number; rate: number; jump?: { from: number; to: number }; hold: boolean } | null = null;
  /** Re-plans the cued mix once staff stop moving a tempo slider. */
  private replanTimer: ReturnType<typeof setTimeout> | undefined;
  /** A song decoded for the jog wheel's scratch that isn't on a deck (a deck loaded before Play). */
  private scratchSong: { id: string; buffer: Promise<AudioBuffer | null> } | null = null;
  private silentSince: number | null = null;

  /** Key-lock is wanted (the setting; it may still be unavailable). */
  private keyLock: boolean;
  private keyLockReady = false;
  /** The deck count wanted (the setting); extra decks go as soon as they're free. */
  private deckTarget: number;

  constructor(deckCount: number, mood: MoodId, deps: AutoDJDeps, keyLock = false) {
    this.engine = new AudioEngine(deckCount);
    this.deckTarget = this.engine.decks.length;
    this.keyLock = keyLock;
    this.moodKey = mood;
    this.deps = deps;
    this.engine.onOutputChange = (missing) => {
      this.note = missing ? "Club speakers output not found — playing on this computer's default output" : null;
      this.emit();
    };
    for (const deck of this.engine.decks) this.watchDeck(deck);
  }

  private watchDeck(deck: Deck): void {
    deck.onUnexpectedEnd = (d) => {
      if (!this.playing || this.paused || this.current?.deck !== d) return;
      // AI DJ off: the song ran to its end and the next one is starting now — that's the plan, not a failure.
      const p = this.planned;
      if (p?.manual && !p.held && this.engine.now >= p.plan.start - 0.5) return;
      // Two songs playing together: the one on air ending hands over (see rearmPair).
      if (p?.layer?.together && !p.held) return;
      void this.recover("track ended early");
    };
  }

  /**
   * The key-lock setting changed. Mid-set every deck crossfades to its new
   * route at once (a very short smear); while stopped it applies at Play.
   */
  async setKeyLock(on: boolean): Promise<void> {
    this.keyLock = on;
    if (!this.playing && on) return this.emit();
    const ok = await this.engine.setKeyLock(on, this.playing ? KEYLOCK_SWITCH_FADE : 0);
    if (this.keyLock !== on) return;
    this.keyLockReady = ok;
    if (on && !ok) this.note = "Key lock isn't available in this browser — tempo changes shift pitch";
    this.emit();
  }

  /**
   * The deck-count setting changed (also mid-set). New decks are ready at
   * once; a deck to remove goes as soon as nothing plays or waits on it.
   */
  setDeckCount(count: number): void {
    this.deckTarget = Math.max(MIN_DECKS, Math.min(MAX_DECKS, Math.round(count)));
    for (const d of this.engine.addDecks(this.deckTarget)) this.watchDeck(d);
    this.trimDecks();
    void this.prepareStandby();
    this.emit();
  }

  /** Remove decks beyond the setting that are free now. */
  private trimDecks(): void {
    if (this.engine.decks.length <= this.deckTarget) return;
    if (this.standby && (this.standby.deck.index >= this.deckTarget || this.deckTarget < 3)) this.dropStandby();
    this.engine.removeFreeDecks(this.deckTarget, [this.current?.deck, this.planned?.deck, this.paused?.deck]);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** The current mood, with any edits the admin made on the Moods page (even mid-set). */
  private get mood(): Mood {
    return this.deps.resolveMood?.(this.moodKey) ?? getMood(this.moodKey);
  }

  get moodId(): MoodId {
    return this.mood.id;
  }

  // ── Public controls ────────────────────────────────────────────────────────

  /**
   * Start the set. With a `preset` (decks staff loaded before Play), Deck A's
   * song plays first from its chosen start and the others come in next, in
   * order, each the way staff chose; then the auto-DJ carries on by itself.
   */
  async start(preset?: StartPreset): Promise<void> {
    if (this.playing) return;
    await this.engine.resume();
    if (this.keyLock !== this.keyLockReady) {
      this.keyLockReady = await this.engine.setKeyLock(this.keyLock);
      if (this.keyLock && !this.keyLockReady) this.note = "Key lock isn't available in this browser — tempo changes shift pitch";
    }
    this.playing = true;
    this.error = null;
    this.generation++;
    const gen = this.generation;
    // Decks loaded before Play come next, in order, ahead of any other requests.
    for (const p of [...(preset?.next ?? [])].reverse()) {
      this.requests = this.requests.filter((t) => t.id !== p.track.id);
      this.requests.unshift(p.track);
      this.requestEntries.set(p.track.id, p.entry);
    }
    const loadedFirst = preset?.first;
    // Deck A's song may already be decoded for a scratch.
    const scratched = loadedFirst && this.scratchSong?.id === loadedFirst.track.id ? await this.scratchSong.buffer : null;
    this.scratchSong = null;
    this.engine.scratch.release();
    const loadedBuffer = loadedFirst ? (scratched ?? (await this.decodeTrack(loadedFirst.track))) : null;
    // Otherwise moods with an opener (Desi Night) start the set with a slow song's hook.
    const opener = loadedBuffer ? null : pickOpener(this.deps.getTracks(), this.mood);
    const openerBuffer = opener ? await this.decodeTrack(opener) : null;
    const first: Loaded | null =
      loadedFirst && loadedBuffer
        ? { track: loadedFirst.track, buffer: loadedBuffer, requested: true }
        : opener && openerBuffer
          ? { track: opener, buffer: openerBuffer, requested: false }
          : await this.loadNextTrack(this.selectionContext(), new Set(), true);
    if (!first || gen !== this.generation) {
      if (first?.requested) this.requests.unshift(first.track);
      this.playing = false;
      this.error = first ? null : "No analysed tracks fit. Add music in the Library page.";
      this.emit();
      return;
    }
    const deck = (loadedFirst && first.track === loadedFirst.track && this.engine.decks[preset?.firstDeck ?? 0]) || this.engine.decks[0];
    deck.load(first.track, first.buffer, this.loudnessTarget());
    deck.resetControls(1);
    const when = this.engine.now + 0.1;
    // Where it starts: staff's choice for a loaded deck; the hook for an opener.
    const fs: FirstStart =
      loadedFirst && first.track === loadedFirst.track
        ? firstStart(first.track, loadedFirst.entry, !!this.mood.opener)
        : first.track === opener
          ? (({ start, end }) => ({ start, openerEnd: end }))(openerWindow(first.track))
          : { start: defaultStart(first.track) };
    deck.start(when, fs.start, 1, fs.jump && { at: when + fs.jump.after, to: fs.jump.to });
    this.openerEnd = fs.openerEnd ?? null;
    const isOpener = this.openerEnd !== null;
    // Pick the party track against the mood's tempo, not the slow opener's.
    this.jump = isOpener;
    if (isOpener) this.note = `Opening with the hook of ${first.track.title}`;
    this.current = { deck, track: first.track, startedAt: when, from: fs.start };
    this.remember(first.track);
    this.deps.onPlayed?.(first.track, "start", first.requested, this.mood.id);
    this.startWatchdog();
    this.emit();
    void this.planNext();
  }

  async stop(): Promise<void> {
    if (!this.playing) return;
    this.playing = false;
    this.generation++;
    this.cancelPlanned();
    this.stopWatchdog();
    this.dropRequested = false;
    this.openerEnd = null;
    this.fxWindows = [];
    this.paused = null;
    this.pausedAlong = null;
    this.loops.clear();
    this.armed.clear();
    this.cuePoints.clear();
    this.cueHeld = null;
    this.endEjectHold();
    await this.engine.fadeOutAndStop(STOP_FADE_SECONDS);
    for (const d of this.engine.decks) d.unload();
    this.current = null;
    this.standby = null;
    this.note = null;
    this.emit();
  }

  /** Staff changed the mood. The music never cuts; the engine steers toward it. */
  setMood(id: MoodId): void {
    if (id === this.moodKey) return;
    this.moodKey = id;
    this.moodTrackIndex = 0;
    if (!this.playing || !this.current) {
      this.emit();
      return;
    }
    this.jump = isMoodJump(this.currentBpm(), this.mood);
    this.moodTracksLeft = this.jump ? 1 : 3;
    this.note = this.jump ? `Switching to ${this.mood.name} with an echo-out` : `Easing into ${this.mood.name} over the next few tracks`;
    // A transition that hasn't started yet is re-planned for the new mood;
    // one already running finishes as planned. While paused, the next song is chosen again on ▶.
    if (this.paused) {
      this.cancelPlanned();
      this.dropStandby();
      void this.planNext();
    } else if (this.planned && this.planned.plan.start > this.engine.now + SCHEDULE_MARGIN + 1) {
      this.cancelPlanned();
      this.dropStandby();
      void this.planNext();
    } else {
      this.dropStandby();
    }
    this.emit();
  }

  /**
   * Staff pressed Drop: on the next 4-bar boundary, the next track comes in
   * straight on its drop instead of waiting for the planned mix. Reuses the
   * already-decoded next track. Ignored (returns false) once a transition is
   * running or about to start.
   */
  drop(): boolean {
    if (!this.playing || !this.current || this.recovering) return false;
    // Paused with nothing else playing: nothing to drop into (a pair with one deck paused still swaps).
    if (this.paused && !this.planned?.layer) return false;
    // Loop, then drop: the loops let go and the next song comes in on its drop.
    this.endLoops();
    // Two songs layered: Drop swaps them.
    if (this.planned?.layer) return this.finishLayer();
    // The live song is still in its dialogue: let it reach its drop first.
    if (this.current.deck.pendingJump() !== null) return false;
    const p = this.planned;
    if (p && p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return false;
    if (p?.staffDrop) return true;
    this.dropRequested = true;
    const up = this.unplan();
    if (up) this.reschedule(up);
    // Still choosing / decoding: schedule() picks the request up.
    else void this.planNext();
    return true;
  }

  /**
   * Staff chose where the cued song comes in (booth "Start from"). Re-plans
   * the cued transition; ignored once the song is playing.
   */
  setEntry(choice: EntryChoice): boolean {
    const p = this.planned;
    if (!this.playing || !p) return false;
    // Paused: nothing is scheduled yet; it comes in this way on ▶.
    if (p.held) {
      p.entry = choice;
      p.startAt = startOf(p.track, choice);
      this.emit();
      return true;
    }
    if (!this.isCued(p)) return false;
    this.dropRequested = p.staffDrop;
    const up = this.unplan();
    if (!up) return false;
    this.reschedule(up, choice);
    return true;
  }

  // ── Deck controls (owner decisions of 14–16 Oct 2026) ──────────────────────
  //
  // Every deck is a plain player: ▶ / ⏸, CUE, loops, cue pads, tempo and the jog wheel work on any deck with a
  // song, at any time, AI DJ on or off — nothing is locked while a mix runs. A press on ▶, ⏸, CUE or a wheel
  // during the auto-DJ's own mix makes it let go (`letGo`): the two songs play on side by side. The auto-DJ
  // only mixes songs nobody has touched — once staff play, pause or cue a song, it plays to its end and the
  // next song starts then. When a song ends and nothing else is playing, the other deck's song plays.

  /** Two songs playing side by side (one brought in with ▶, or a mix staff took over), not swapping yet. */
  private isPair(p: Planned | null): boolean {
    return !!p?.layer && !p.held && p.plan.drop === undefined;
  }

  /** The next song is cued: loaded but not playing (held, or its mix still to come). */
  private isCued(p: Planned | null): boolean {
    return !!p && (!!p.held || (!p.layer && this.engine.now < p.plan.start));
  }

  /**
   * Staff pressed ▶, ⏸ or CUE, or took a wheel, while the auto-DJ's own mix is under way: it lets go. The two
   * songs play on side by side at full level (nothing swaps until Drop or a song ends) — or, when the song
   * going out is already silent (a cut, an echo-out), the new song is simply on air.
   */
  private letGo(): void {
    const p = this.planned;
    const cur = this.current;
    if (!p || !cur || p.held || this.engine.now < p.plan.start || this.isPair(p)) return;
    if (!this.paused && cur.deck.fader.gain.value < 0.02) {
      clearTimeout(p.timer);
      this.handover();
      return;
    }
    this.toPair(p);
    this.rearmPair(p);
  }

  /**
   * ⏸ on a deck: it stops where it is and keeps its song; nothing else changes. The song on air with nothing
   * else playing: the club hears nothing until ▶ (no watchdog; the cued song stays cued). One of two songs
   * playing side by side: the other plays on. `hold`: a hand on the jog wheel (it plays on when let go).
   */
  pauseDeck(index: number, hold = false): boolean {
    if (!this.playing || !this.current || this.recovering) return false;
    this.letGo();
    const cur = this.current!;
    const p = this.planned;
    const now = this.engine.now;
    const pair = this.isPair(p);
    const fade = hold ? HOLD_FADE : PAUSE_FADE;
    if (cur.deck.index === index) {
      if (this.paused) return false;
      // A pause (or a hand on the wheel) lets the loop go; the song carries on from there afterwards.
      this.endLoopOn(cur.deck);
      cur.touched = true;
      const state = this.pauseStateOf(cur.deck, now, fade);
      cur.deck.resetControls(cur.deck.fader.gain.value);
      cur.deck.fadeOutAndStop(fade);
      this.paused = { deck: cur.deck, ...state, hold };
      this.stopWatchdog();
      if (pair) {
        // The song playing along carries on alone, at full level.
        if (!this.pausedAlong) p!.deck.easeToNeutral(0.05, 1);
        p!.layer!.incFull = true;
        this.rearmPair(p!);
      } else {
        // The cued song waits (nothing starts by itself while the club is silent).
        if (p) this.holdPlanned(p);
        this.dropStandby();
        if (!hold) this.note = null;
      }
      this.emit();
      return true;
    }
    if (pair && p!.deck.index === index && !this.pausedAlong) {
      this.endLoopOn(p!.deck);
      const state = this.pauseStateOf(p!.deck, now, fade);
      p!.deck.resetControls(p!.deck.fader.gain.value);
      p!.deck.fadeOutAndStop(fade);
      this.pausedAlong = { ...state, hold };
      // The song on air plays on alone, at full level.
      if (!this.paused) cur.deck.easeToNeutral(0.05, 1);
      this.rearmPair(p!);
      this.emit();
      return true;
    }
    return false;
  }

  /** Where a deck stops if paused now: its position, tempo (or the tempo it was gliding to) and a dialogue jump still to come. */
  private pauseStateOf(deck: Deck, now: number, fade: number): { position: number; rate: number; jump?: { from: number; to: number } } {
    const tl = deck.timeline;
    const position = deck.position(now + fade);
    const at = deck.pendingJump(now + fade);
    const jump = tl?.jump && at !== null ? { from: tl.positionAt(at - 1e-4), to: tl.jump.to } : undefined;
    const rate = tl?.ramp && tl.ramp.t1 > now ? tl.ramp.r1 : (tl?.rateAt(now) ?? 1);
    return { position, rate, jump };
  }

  /**
   * The jog wheel or a cue pad moved a stopped (or hand-held) song to `position`: ▶ (or letting go) plays on
   * from there. Before a dialogue's end it still jumps to the drop; after it, it plays straight on.
   */
  movePaused(index: number, position: number): boolean {
    const p = this.planned;
    const spot =
      this.paused?.deck.index === index
        ? { state: this.paused, a: this.current?.track.analysis }
        : this.pausedAlong && p?.deck.index === index
          ? { state: this.pausedAlong, a: p.track.analysis }
          : null;
    if (!spot?.a) return false;
    const s = spot.state;
    s.position = Math.max(0, Math.min(spot.a.duration - 1, position));
    if (s.jump && s.position >= s.jump.from) s.jump = undefined;
    this.emit();
    return true;
  }

  /**
   * ▶ on a deck: it plays, at once.
   *  - A stopped song carries on from where it is — in time with the other deck when that one is playing and
   *    the two can be beat-matched (on its next beat, in the same place in the bar), else straight away.
   *  - The cued song plays together with the song on air (beat-matched on its next beat when they can be), both
   *    at full level, until Drop or one of them ends — or on its own when nothing else is playing.
   * `fade`: how a stopped song on air fades back in.
   */
  playDeck(index: number, fade = RESUME_FADE): boolean {
    if (!this.playing || !this.current || this.recovering) return false;
    // CUE held on this deck (it's playing from the cue point): it plays on when CUE is let go, like a CDJ.
    if (this.cueHeld?.deck.index === index) return this.keepCue();
    this.letGo();
    const cur = this.current!;
    const p = this.planned;
    const pair = this.isPair(p);
    // The song playing along, stopped: back in, in time with the song on air (or on its own).
    if (pair && this.pausedAlong && p!.deck.index === index) {
      const state = this.pausedAlong;
      this.pausedAlong = null;
      if (state.hold || this.paused) this.startNow(p!.deck, p!.track, state, state.hold ? HOLD_FADE : 0.05);
      else this.resumeSynced(p!.deck, p!.track, state, cur);
      p!.layer!.incFull = true;
      this.rearmPair(p!);
      this.emit();
      return true;
    }
    if (this.paused?.deck.index === index) {
      const state = this.paused;
      this.paused = null;
      cur.touched = true;
      // Back in time with the song playing along — or, let go by the hand / on its own, straight away.
      if (pair && !this.pausedAlong && !state.hold) this.resumeSynced(state.deck, cur.track, state, { deck: p!.deck, track: p!.track });
      else this.startNow(state.deck, cur.track, state, state.hold ? HOLD_FADE : fade);
      this.startWatchdog();
      const a = cur.track.analysis;
      // Moved right up to the song's end: let the auto-DJ take over as if it had ended.
      if (a && state.position > a.duration - 2) void this.recover("end of song");
      else this.afterLiveResume();
      this.emit();
      return true;
    }
    // Already playing.
    if (index === cur.deck.index || (p?.deck.index === index && !this.isCued(p))) return true;
    // ▶ on the cued song.
    if (!p || p.deck.index !== index) return false;
    const up = this.unplan();
    if (!up) return false;
    // With the song on air paused it plays on its own (the paused one stays where it is).
    this.scheduleLayer(up.track, up.buffer, up.requested, up.entry, { tempo: up.tempo, alone: !!this.paused });
    return true;
  }

  /** The song on air plays again (▶, a wheel let go, CUE then ▶): the cued song is planned around it again. */
  private afterLiveResume(): void {
    const p = this.planned;
    if (this.isPair(p)) this.rearmPair(p!);
    else if (p?.held) {
      const up = this.unplan();
      if (up) this.reschedule(up);
    } else if (!p) void this.planNext();
  }

  /**
   * Start a stopped deck again at `state`, on `partner`'s next beat and in time with it (its beat-in-bar and
   * tempo matched) — or straight away when the tempos can't be matched.
   */
  private resumeSynced(
    deck: Deck,
    track: Track,
    state: { position: number; rate: number; jump?: { from: number; to: number } },
    partner: { deck: Deck; track: Track },
  ): void {
    const a = track.analysis!;
    const now = this.engine.now;
    let when = now + 0.05;
    let pos = this.intoArmed(track, state.position);
    let rate = state.rate;
    const ptl = partner.deck.timeline;
    const b = partner.track.analysis;
    if (ptl && b) {
      const pBeat = nextBoundary(b, ptl.positionAt(now + 0.1), 1 / BEATS_PER_BAR);
      const at = ptl.timeAt(pBeat);
      const partnerBpm = b.bpm * ptl.rateAt(at);
      const m = syncRatio(partnerBpm, a.bpm, this.mood.halfTime);
      if (m !== null) {
        when = at;
        rate = partnerBpm / (a.bpm * m);
        // From its next beat, moved on to the same beat of the bar as the partner's.
        const beatA = 60 / a.bpm;
        pos = a.firstBeat + Math.ceil((pos - a.firstBeat) / beatA - 1e-6) * beatA;
        const kP = ((Math.round((pBeat - b.firstBeat) / (60 / b.bpm)) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
        let kA = ((Math.round((pos - a.firstBeat) / beatA) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
        for (let i = 0; i < 3 && kA !== kP; i++) {
          pos += beatA;
          kA = (kA + 1) % BEATS_PER_BAR;
        }
        pos = this.intoArmed(track, pos);
      }
    }
    const jump = state.jump && pos < state.jump.from ? { at: when + (state.jump.from - pos) / rate, to: state.jump.to } : undefined;
    deck.resetControls(0);
    deck.start(when, Math.min(pos, a.duration - 1), rate, jump);
    deck.fader.gain.setValueAtTime(0, when);
    deck.fader.gain.linearRampToValueAtTime(1, when + 0.05);
    this.applyArmed(deck, track);
  }

  /** Start a stopped deck at once from `state`, at its own tempo (CUE, a wheel let go, a song on its own). */
  private startNow(deck: Deck, track: Track, state: { position: number; rate: number; jump?: { from: number; to: number } }, fade = HOLD_FADE): void {
    const a = track.analysis!;
    const when = this.engine.now + 0.03;
    const pos = Math.min(this.intoArmed(track, state.position), a.duration - 1);
    const jump = state.jump && pos < state.jump.from ? { at: when + (state.jump.from - pos) / state.rate, to: state.jump.to } : undefined;
    deck.resetControls(0);
    deck.start(when, pos, state.rate, jump);
    deck.fader.gain.setValueAtTime(0, when);
    deck.fader.gain.linearRampToValueAtTime(1, when + fade);
    this.applyArmed(deck, track);
  }

  /** A loop armed on a stopped song: where it plays from (inside the loop). */
  private intoArmed(track: Track, position: number): number {
    const l = this.armed.get(track.id);
    if (!l || l.end <= l.start) return position;
    return position >= l.start && position < l.end ? position : l.start;
  }

  /** The song on `deck` just started: a loop armed on it starts looping. */
  private applyArmed(deck: Deck, track: Track): void {
    const l = this.armed.get(track.id);
    if (!l) return;
    this.armed.delete(track.id);
    if (deck.setLoop(l.start, l.end)) this.loops.set(deck, l);
  }

  // ── Eject ────────────────────────────────────────────────────────────────────

  /**
   * ⏏ on a deck that isn't playing — the cued song, or a song stopped beside the one on air — takes its song off,
   * like a CDJ (a playing song can't be ejected). The deck stays empty until staff LOAD a song; the auto-DJ fills it
   * by itself only when the song on air is EJECT_REFILL_SECONDS from its end, so the music never stops.
   */
  eject(index: number): boolean {
    const p = this.planned;
    const deck = this.engine.decks[index];
    if (!this.playing || !p || !deck || p.deck !== deck || this.recovering) return false;
    if (!this.isCued(p) && !(this.isPair(p) && this.pausedAlong)) return false;
    if (this.cueHeld?.deck === deck) this.cueHeld = null;
    clearTimeout(p.timer);
    clearTimeout(p.layer?.endTimer);
    this.loops.delete(deck);
    this.armed.delete(p.track.id);
    this.pausedAlong = null;
    this.cancelTransitionFx(p);
    deck.unload();
    deck.resetControls(0);
    this.planned = null;
    // The song on air plays on at full level, untouched by the mix that was planned.
    this.current?.deck.resetControls(1);
    this.dropRequested = false;
    this.note = `Deck ${"ABCD"[index]} is empty — LOAD a song, or the auto-DJ picks one before this song ends`;
    this.endEjectHold();
    this.ejectHold = setInterval(() => this.checkEjectHold(), 1000);
    this.checkEjectHold();
    this.emit();
    return true;
  }

  /** While a deck is ejected: fill it once the song on air is near its end (it's playing, not looping). */
  private checkEjectHold(): void {
    const cur = this.current;
    const tl = cur?.deck.timeline;
    const a = cur?.track.analysis;
    if (!this.ejectHold || !this.playing || !cur || !tl || !a) return;
    if (this.paused || this.loops.has(cur.deck)) return;
    if (tl.timeAt(a.duration) - this.engine.now > EJECT_REFILL_SECONDS) return;
    this.endEjectHold();
    if (this.note?.includes("is empty")) this.note = null;
    void this.planNext();
  }

  private endEjectHold(): void {
    if (this.ejectHold) clearInterval(this.ejectHold);
    this.ejectHold = null;
  }

  // ── The staff mixer (owner decision: the knobs, faders and crossfader work) ──

  /** Staff moved a channel's TRIM / EQ / CFX knobs or its fader. On its own stage: the auto-DJ's mix carries on. */
  setMixer(index: number, channel: MixerChannel): void {
    this.engine.setMixer(index, channel);
  }

  /** Staff moved the crossfader (0 = Deck A only, 0.5 = both, 1 = Deck B only). */
  setCrossfader(x: number): void {
    this.engine.setCrossfader(x);
  }

  // ── CUE, like a CDJ's (owner decision of 16 Oct 2026) ──────────────────────

  /** A deck's cue point (track seconds): set with CUE, else where its song started (the cued song: its start point). */
  private cueAt(deck: Deck): number {
    const c = this.cuePoints.get(deck);
    if (c && c.trackId === deck.track?.id) return c.at;
    const p = this.planned;
    if (p && deck === p.deck) return this.isCued(p) ? startOf(p.track, p.entry) : p.startAt;
    return this.current?.deck === deck ? this.current.from : 0;
  }

  /**
   * CUE pressed (`down`) or let go on a deck, like a CDJ:
   *  - playing: it goes back to its cue point and stops there (▶ then plays from it);
   *  - stopped somewhere else (paused, or moved with the wheel or a cue pad): that spot becomes the cue point;
   *  - stopped at its cue point: it plays from there while CUE is held and goes back when let go — unless ▶
   *    was pressed meanwhile (it plays on).
   * The cued song's cue point is its start point: holding CUE plays it from there on the club speakers; from
   * then on the auto-DJ leaves it alone (it starts when the song on air ends, or on ▶).
   */
  cue(index: number, down: boolean): boolean {
    const deck = this.engine.decks[index];
    if (!deck) return false;
    if (!down) return this.cueUp(deck);
    if (!this.playing || !this.current || this.recovering || this.cueHeld) return false;
    this.letGo();
    const p = this.planned;
    const song = this.songOn(deck);
    if (!song) return false;
    const at = this.cueAt(deck);
    if (song.playing) {
      if (!this.pauseDeck(index)) return false;
      return this.movePaused(index, at);
    }
    if (p && deck === p.deck && this.isCued(p)) {
      const up = this.unplan();
      if (!up) return false;
      this.scheduleLayer(up.track, up.buffer, up.requested, up.entry, { tempo: up.tempo, alone: true, quiet: true });
      this.cueHeld = { deck, at: this.planned?.startAt ?? at, cued: true };
      this.emit();
      return true;
    }
    if (Math.abs(song.at - at) > CUE_SNAP) {
      this.cuePoints.set(deck, { trackId: song.track.id, at: song.at });
      this.emit();
      return true;
    }
    const live = deck === this.current!.deck;
    const state = live ? this.paused : this.pausedAlong;
    if (!state) return false;
    if (live) this.paused = null;
    else this.pausedAlong = null;
    this.startNow(deck, song.track, state);
    if (this.isPair(p)) this.rearmPair(p!);
    this.cueHeld = { deck, at, cued: false };
    this.emit();
    return true;
  }

  /** CUE let go: a song playing from its cue point goes back there (the cued song: cued again, left alone). */
  private cueUp(deck: Deck): boolean {
    const held = this.cueHeld;
    if (!held || held.deck !== deck) return false;
    this.cueHeld = null;
    const p = this.planned;
    if (held.cued && p?.deck === deck && this.isPair(p)) {
      const up = this.unplan();
      if (!up) return false;
      if (this.paused) this.hold(up.track, up.buffer, up.requested, up.entry, true);
      else this.reschedule({ ...up, touched: true });
      this.emit();
      return true;
    }
    if (!this.pauseDeck(deck.index, true)) return false;
    // (Stopped by CUE, not by a hand on the wheel.)
    if (this.paused?.deck === deck) this.paused.hold = false;
    else if (this.pausedAlong) this.pausedAlong.hold = false;
    return this.movePaused(deck.index, held.at);
  }

  /** ▶ while CUE is held: the song plays on from where it is. */
  private keepCue(): boolean {
    const held = this.cueHeld!;
    this.cueHeld = null;
    if (held.deck === this.current?.deck) {
      this.startWatchdog();
      this.afterLiveResume();
    }
    this.emit();
    return true;
  }

  /**
   * Staff moved a deck's tempo slider (playback rate, within ±MAX_TEMPO). A song that is playing glides there
   * at once (key-lock keeps its key); a stopped one plays on at that tempo. The cued song: the tempo it
   * settles at after its mix (during the mix it's beat-matched to the song on air). The cued mix is re-timed
   * once the slider rests; a mix under way carries on.
   */
  setDeckTempo(index: number, rate: number): boolean {
    const cur = this.current;
    if (!this.playing || !cur || this.recovering) return false;
    const r = Math.max(1 - MAX_TEMPO, Math.min(1 + MAX_TEMPO, rate));
    const own = Math.abs(r - 1) < 0.0005 ? undefined : r;
    const p = this.planned;
    const pair = this.isPair(p);
    if (cur.deck.index === index) {
      if (this.paused) this.paused.rate = r;
      else cur.deck.changeRate(r);
      if (pair) this.rearmPair(p!);
      else if (p && !p.held && this.isCued(p)) this.replanSoon();
      this.emit();
      return true;
    }
    if (p && p.deck.index === index) {
      p.tempo = own;
      if (pair) {
        if (this.pausedAlong) this.pausedAlong.rate = r;
        else p.deck.changeRate(r);
        this.rearmPair(p);
      } else if (!this.isCued(p)) {
        // Its mix is under way: it goes to that tempo now (instead of gliding to its own after the mix).
        p.deck.changeRate(r);
      } else if (!p.held) this.replanSoon();
      this.emit();
      return true;
    }
    return false;
  }

  /**
   * Beat loop, `beats` long (¼ … 16), on any deck. On a playing song it starts on the beat the playhead is in,
   * so it wraps on the grid; pressed while looping, it resizes from the same start. On a stopped song (paused,
   * or the cued one) it is armed from where it stands: it loops from there once the song plays.
   */
  loop(index: number, beats: number): boolean {
    const deck = this.engine.decks[index];
    const song = this.songOn(deck);
    const a = song?.track.analysis;
    if (!deck || !song || !a) return false;
    const beat = 60 / a.bpm;
    const length = beats * beat;
    let start: number;
    if (song.playing) {
      const pos = deck.timeline!.positionAt(this.engine.now + 0.03);
      start = this.loops.get(deck)?.start ?? a.firstBeat + Math.floor((pos - a.firstBeat) / beat) * beat;
      // Short loops: the first loop-length step that is still ahead of the playhead.
      while (start + length <= pos + 0.02) start += length;
    } else {
      start = this.armed.get(song.track.id)?.start ?? a.firstBeat + Math.floor((song.at - a.firstBeat) / beat + 0.02) * beat;
    }
    return this.loopAt(index, Math.max(0, start), Math.min(a.duration - 0.05, start + length), beats);
  }

  /** A saved loop: loop there (jumping to it on the beat if the song is past it); on a stopped song, arm it. */
  savedLoop(index: number, start: number, end: number): boolean {
    return this.loopAt(index, start, end, null);
  }

  /** The song on a deck and whether it is playing; a stopped one (paused, or cued) stands at `at`. */
  private songOn(deck: Deck | undefined): { track: Track; playing: boolean; at: number } | null {
    const cur = this.current;
    const p = this.planned;
    if (!deck || !this.playing || !cur || this.recovering) return null;
    if (deck === cur.deck) return { track: cur.track, playing: !this.paused, at: this.paused?.position ?? 0 };
    if (p && deck === p.deck) {
      if (this.isCued(p)) return { track: p.track, playing: false, at: p.startAt };
      if (this.isPair(p) && this.pausedAlong) return { track: p.track, playing: false, at: this.pausedAlong.position };
      return { track: p.track, playing: true, at: 0 };
    }
    return null;
  }

  private loopAt(index: number, start: number, end: number, beats: number | null): boolean {
    const deck = this.engine.decks[index];
    const song = this.songOn(deck);
    const a = song?.track.analysis;
    if (!deck || !song || !a || end <= start) return false;
    const p = this.planned;
    if (!song.playing) {
      // Armed: it loops once the song plays. The cued song now starts from the loop's start.
      this.armed.set(song.track.id, { start, end, beats });
      if (p && deck === p.deck && this.isCued(p)) this.setEntry({ kind: "bar", bar: (start - a.firstBeat) / barSeconds(a) });
      this.emit();
      return true;
    }
    const tl = deck.timeline!;
    const now = this.engine.now;
    // Past the loop: jump to its start on the next beat, then loop.
    if (tl.positionAt(now + 0.03) >= end) {
      const at = tl.timeAt(nextBoundary(a, tl.positionAt(now + 0.08), 1 / BEATS_PER_BAR));
      if (!deck.jumpAt(at, start)) return false;
    }
    if (!deck.setLoop(start, end)) return false;
    this.loops.set(deck, { start, end, beats });
    // The song on air loops: a cued mix waits for it (one already under way carries on).
    if (deck === this.current!.deck && p && !p.held && this.isCued(p)) this.holdPlanned(p);
    // Two songs side by side: a looping song doesn't end; the ends are timed again.
    if (this.isPair(p)) this.rearmPair(p!);
    this.emit();
    return true;
  }

  /** Let the loop on a deck go (or disarm a stopped song's): the song plays on from there. */
  exitLoop(index: number): boolean {
    const deck = this.engine.decks[index];
    const p = this.planned;
    const id = deck?.track?.id;
    if (deck && id && this.armed.has(id) && !this.loops.has(deck)) {
      this.armed.delete(id);
      this.emit();
      return true;
    }
    if (!deck || !this.loops.has(deck)) return false;
    this.endLoopOn(deck);
    if (deck === this.current?.deck) {
      // The song on air: the held mix is planned again from where it is now.
      const up = p?.held && !this.paused ? this.unplan() : null;
      if (up) this.reschedule(up);
      else if (this.isPair(p)) this.rearmPair(p!);
      else if (!p) void this.planNext();
    } else if (this.isPair(p)) {
      this.rearmPair(p!);
    }
    this.emit();
    return true;
  }

  /** The song on air is looping (its planned mix waits). */
  private liveLooping(): boolean {
    return !!this.current && this.loops.has(this.current.deck);
  }

  private endLoopOn(deck: Deck): void {
    if (!this.loops.has(deck)) return;
    deck.clearLoop();
    this.loops.delete(deck);
  }

  /** Every loop lets go (Drop, a mix). */
  private endLoops(): void {
    for (const deck of [...this.loops.keys()]) this.endLoopOn(deck);
  }

  /**
   * AI DJ mode. Off: the auto-DJ still picks and cues the next song (and beat-matches whatever staff bring in)
   * but never mixes by itself — each song plays to its end and the cued one starts then (Drop or ▶ mix by
   * hand). On: it mixes songs nobody has touched. A cued mix that hasn't started is re-planned for the new mode.
   */
  setAuto(on: boolean): void {
    if (this.auto === on) return;
    this.auto = on;
    const p = this.planned;
    if (this.playing && p && !p.held && !p.staffDrop && this.isCued(p)) {
      this.dropRequested = false;
      const up = this.unplan();
      if (up) this.reschedule(up);
    }
    if (on && this.note?.startsWith("AI DJ")) this.note = null;
    this.emit();
  }

  /**
   * Sync: set one deck's tempo so its BPM matches the other's. Half / double tempo counts (a 64 BPM ballad
   * syncs to 128). False when they're more than 8% apart, or there's no other song.
   */
  syncDeck(index: number): boolean {
    const cur = this.current;
    const p = this.planned;
    const a = cur?.track.analysis;
    const b = p?.track.analysis;
    if (!this.playing || !cur || !p || !a || !b) return false;
    const now = this.engine.now;
    const liveRate = this.paused?.deck === cur.deck ? this.paused.rate : (cur.deck.timeline?.rateAt(now) ?? 1);
    // The other song's tempo: the cued one's after its mix, else the rate it's playing (or stopped) at.
    const otherRate = this.isCued(p) ? (p.tempo ?? 1) : this.pausedAlong ? this.pausedAlong.rate : (p.deck.timeline?.rateAt(now) ?? 1);
    if (index === cur.deck.index) {
      const target = b.bpm * otherRate;
      const m = syncRatio(target, a.bpm, true);
      return m !== null && this.setDeckTempo(index, target / (a.bpm * m));
    }
    if (index === p.deck.index) {
      const liveBpm = a.bpm * liveRate;
      const m = syncRatio(liveBpm, b.bpm, true);
      return m !== null && this.setDeckTempo(index, liveBpm / (b.bpm * m));
    }
    return false;
  }

  /**
   * A cue pad: a playing song jumps to track position `to` on its next beat (the groove carries on in time;
   * a loop or a dialogue still to come is let go). A stopped song moves there. (On the cued song the booth
   * sets its start point instead.)
   */
  jumpTo(index: number, to: number): boolean {
    if (!this.playing || !this.current || this.recovering) return false;
    const deck = this.engine.decks[index];
    const song = this.songOn(deck);
    const a = song?.track.analysis;
    if (!deck || !song || !a) return false;
    const target = Math.max(0, Math.min(a.duration - 1, to));
    if (!song.playing) return this.isCued(this.planned) && this.planned!.deck === deck ? false : this.movePaused(index, target);
    if (this.loops.has(deck)) this.exitLoop(index);
    const tl = deck.timeline;
    if (!tl) return false;
    const now = this.engine.now;
    const at = tl.timeAt(nextBoundary(a, tl.positionAt(now + 0.08), 1 / BEATS_PER_BAR));
    if (!deck.jumpAt(at, target)) return false;
    const p = this.planned;
    if (this.isPair(p)) this.rearmPair(p!);
    else if (deck === this.current!.deck && p && !p.held && this.isCued(p)) {
      // The mix point moved with the song: plan the cued mix again from the new position.
      this.dropRequested = p.staffDrop;
      const up = this.unplan();
      if (up) this.reschedule(up);
    }
    this.emit();
    return true;
  }

  /** Re-plan the cued mix (its times and tempo) once a tempo slider has rested for 300 ms. */
  private replanSoon(): void {
    clearTimeout(this.replanTimer);
    const gen = this.generation;
    this.replanTimer = setTimeout(() => {
      const p = this.planned;
      if (gen !== this.generation || !this.playing || this.paused || !p || p.held || !this.isCued(p)) return;
      this.dropRequested = p.staffDrop;
      const up = this.unplan();
      if (up) this.reschedule(up);
    }, 300);
  }

  /**
   * A fast backward flick of the jog wheel on the song on air (held by the
   * hand): it spins back like a record and the cued song drops in on its drop
   * (through its dialogue if it has one). False if no song is cued yet.
   */
  spinBack(): boolean {
    const held = this.paused;
    const p = this.planned;
    if (!this.playing || !held?.hold || !this.current || !p?.held || !p.deck.buffer) return false;
    const when = this.engine.now + 0.02;
    const old = held.deck;
    old.rewind(when, REWIND_SECONDS, held.position);
    const deck = p.deck;
    const up = this.unplan()!;
    this.paused = null;
    const e = resolveEntry(up.track, up.entry);
    const at = when + REWIND_LEAD;
    deck.resetControls(1);
    if (e.dialogue) deck.start(at, e.dialogue.start, 1, { at: at + (e.dialogue.end - e.dialogue.start), to: e.land });
    else deck.start(at, e.land, up.tempo ?? 1);
    this.current = { deck, track: up.track, startedAt: at, from: e.dialogue?.start ?? e.land, touched: !!up.touched };
    this.remember(up.track);
    this.deps.onPlayed?.(up.track, "rewind", up.requested, this.mood.id);
    if (this.jump) this.jump = false;
    this.openerEnd = null;
    this.note = null;
    this.startWatchdog();
    this.emit();
    // Once the spinback has played out: free its deck, then cue the next song.
    const gen = this.generation;
    setTimeout(() => {
      if (old !== this.current?.deck && old !== this.planned?.deck) old.unload();
      if (gen === this.generation) void this.planNext();
    }, (REWIND_SECONDS + 0.3) * 1000);
    return true;
  }

  /** The set is pausing: take back a cued transition that hasn't started, keeping its song loaded. */
  private holdPlanned(p: Planned): void {
    clearTimeout(p.timer);
    p.deck.stopNow();
    p.deck.resetControls(0);
    this.cancelTransitionFx(p);
    p.plan = HELD_PLAN;
    p.held = true;
    p.staffDrop = false;
    p.layer = undefined;
  }

  /**
   * A mix under way becomes a pair (staff took it over): its automation, effects and tempo glide stop, both
   * decks go to full level, and nothing swaps until Drop (or a song runs out).
   */
  private toPair(p: Planned): void {
    const cur = this.current!;
    const now = this.engine.now;
    clearTimeout(p.timer);
    this.cancelTransitionFx(p);
    cur.deck.easeToNeutral(0.05, 1);
    p.deck.easeToNeutral(0.05, 1);
    const rate = p.deck.timeline?.rateAt(now) ?? 1;
    p.deck.changeRate(rate, 0.01);
    p.plan = { kind: "layer", start: p.plan.start, end: Number.POSITIVE_INFINITY };
    p.layer = { rate, together: true, incFull: true };
    p.touched = true;
  }

  /**
   * Two songs playing side by side: nothing mixes or swaps by itself (only Drop does). Each one that is playing
   * (not stopped, not looping) plays to its own end (`songEnded`). Re-armed after every pause, ▶, loop, tempo
   * change or jump.
   */
  private rearmPair(p: Planned): void {
    const cur = this.current!;
    const now = this.engine.now;
    if (!p.layer) return;
    clearTimeout(p.timer);
    clearTimeout(p.layer.endTimer);
    p.layer.swapAt = undefined;
    const endAt = (deck: Deck, x: NonNullable<Track["analysis"]>) => (deck.timeline ? deck.timeline.timeAt(x.duration) - 0.06 : Infinity);
    const ms = (t: number) => Math.max(0, (t - now) * 1000);
    if (!this.paused && !this.loops.has(cur.deck)) {
      const t = endAt(cur.deck, cur.track.analysis!);
      if (Number.isFinite(t)) p.timer = setTimeout(() => this.songEnded(p, "live"), ms(t));
    }
    if (!this.pausedAlong && !this.loops.has(p.deck)) {
      const t = endAt(p.deck, p.track.analysis!);
      if (Number.isFinite(t)) p.layer.endTimer = setTimeout(() => this.songEnded(p, "along"), ms(t));
    }
  }

  /**
   * A song of a pair reached its end. With the other one playing, that one simply plays on (the song on air
   * ending hands over to it; the song playing along ending frees its deck for the next song). With the other
   * one stopped, nothing would be playing — so it plays on from where it stands: the music never stops by
   * itself.
   */
  private songEnded(p: Planned, which: "live" | "along"): void {
    if (this.planned !== p || !this.playing || !p.layer) return;
    if (this.cueHeld && (which === "live" ? this.cueHeld.deck === this.current?.deck : this.cueHeld.deck === p.deck)) this.cueHeld = null;
    if (which === "live") {
      clearTimeout(p.layer.endTimer);
      const along = this.pausedAlong;
      this.handover();
      const cur = this.current;
      if (along && cur) {
        this.startNow(cur.deck, cur.track, along, 0.05);
        this.startWatchdog();
        this.emit();
      }
      return;
    }
    clearTimeout(p.timer);
    this.loops.delete(p.deck);
    this.pausedAlong = null;
    p.deck.stopNow();
    p.deck.unload();
    this.planned = null;
    this.note = null;
    const st = this.paused;
    const cur = this.current;
    if (st && cur) {
      this.paused = null;
      this.startNow(st.deck, cur.track, st, 0.05);
      this.startWatchdog();
    }
    this.emit();
    void this.planNext();
  }

  /** Take back the next song (cued, or playing along), keeping its decoded track for a re-plan. */
  private unplan(): Unplanned | null {
    const p = this.planned;
    if (!p?.deck.buffer) return null;
    const buffer = p.deck.buffer;
    clearTimeout(p.timer);
    clearTimeout(p.layer?.endTimer);
    this.loops.delete(p.deck);
    this.pausedAlong = null;
    p.deck.stopNow();
    p.deck.resetControls(0);
    this.planned = null;
    this.cancelTransitionFx(p);
    // The planned mix hasn't started: drop its automation, keep the music at full level.
    this.current?.deck.resetControls(1);
    return { track: p.track, buffer, requested: p.requested, entry: p.entry, deferred: p.deferred, tempo: p.tempo, touched: p.touched };
  }

  /** Plan a taken-back song again (the way it was: staff's tempo, left alone if staff touched it). */
  private reschedule(up: Unplanned, entry = up.entry): void {
    this.schedule(up.track, up.buffer, up.requested, entry, { deferred: up.deferred, tempo: up.tempo, touched: up.touched });
  }

  /**
   * Staff chose a track. `next`: it replaces the cued track (if that mix hasn't
   * started; otherwise it plays right after). Else it joins the end of the
   * queue. The auto-DJ still picks the transition, syncs the tempo and times
   * the mix for the mood, and steers back into the mood afterwards.
   */
  request(track: Track, next: boolean): void {
    if (track.status !== "ready" || !track.analysis || track.id === this.current?.track.id) return;
    // LOAD into an ejected deck: it's filled now.
    this.endEjectHold();
    this.requests = this.requests.filter((t) => t.id !== track.id);
    const p = this.planned;
    // It replaces the next song while that one isn't playing (cued, or stopped beside the song on air).
    if (next && p && p.track.id !== track.id && this.playing && (this.isCued(p) || (this.isPair(p) && this.pausedAlong))) {
      const wasDrop = p.staffDrop;
      this.cancelPlanned();
      this.requests.unshift(track);
      this.dropRequested ||= wasDrop;
      void this.planNext();
    } else if (p?.track.id !== track.id) {
      if (next) this.requests.unshift(track);
      else this.requests.push(track);
      if (this.playing && !p) void this.planNext();
    }
    this.emit();
  }

  /** Remove a track from the request queue. */
  unrequest(trackId: string): void {
    this.requests = this.requests.filter((t) => t.id !== trackId);
    this.requestEntries.delete(trackId);
    this.emit();
  }

  /**
   * Every playable track for the staff picker, best fit for the mood and the
   * playing track first — minus the cued next track and anything already queued.
   */
  rankTracks(tracks: Track[]): RequestOption[] {
    const taken = new Set([this.planned?.track.id, ...this.requests.map((t) => t.id)]);
    return rankForRequest(tracks, this.selectionContext()).filter((o) => !taken.has(o.track.id));
  }

  /**
   * Staff fired an effect on the whole mix. It starts on the live deck's next
   * beat (the riser on the next downbeat, so it ends on one) and is scheduled
   * on the audio clock like everything else.
   */
  fx(kind: FxKind): void {
    const c = this.current;
    const a = c?.track.analysis;
    const tl = c?.deck.timeline;
    if (!this.playing || !a || !tl) return;
    // Effects act on the master, which hears each deck `outputDelay` late.
    const delay = this.engine.outputDelay;
    const pos = tl.positionAt(this.engine.now + 0.05 - delay);
    const target = nextBoundary(a, pos, kind === "riser" ? 1 : 1 / BEATS_PER_BAR);
    const t = tl.timeAt(target);
    const end = this.engine.fx.trigger(kind, t + delay, 60 / (a.bpm * tl.rateAt(t)));
    this.noteFx(kind, t + delay, end, false);
  }

  /**
   * Jog wheel on a loaded or cued deck: scratch its song at `position` (seconds) on
   * the club speakers — or, with `step`, play a short stretch from there. Only
   * sound: it never moves a deck or its automation (the start point is set
   * through `setEntry` when the wheel is let go).
   */
  async scratch(track: Track, position: number, step = false): Promise<void> {
    // During a set the cued deck holds its song (silent until it's decoded: no extra copy in memory).
    // Before Play, a loaded deck's song is decoded once here and reused when the set starts.
    let buffer = this.engine.decks.find((d) => d.track?.id === track.id)?.buffer ?? null;
    if (!buffer && !this.playing) {
      let song = this.scratchSong;
      if (song?.id !== track.id) {
        song = { id: track.id, buffer: this.deps.getFile(track).then((f) => this.engine.decode(f)).catch(() => null) };
        this.scratchSong = song;
      }
      buffer = await song.buffer;
    }
    if (!buffer) return;
    await this.engine.resume().catch(() => undefined);
    await this.engine.scratch.move(buffer, position, step);
  }

  scratchEnd(): void {
    this.engine.scratch.end();
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.engine.close();
  }

  // ── Planning ────────────────────────────────────────────────────────────────

  private currentBpm(): number | null {
    const c = this.current;
    if (!c?.track.analysis || !c.deck.timeline) return null;
    return c.track.analysis.bpm * c.deck.timeline.rateAt(this.engine.now);
  }

  /** Every track is volume-matched to the library's typical loudness. */
  private loudnessTarget(): number {
    return libraryLoudness(this.deps.getTracks().map((t) => t.analysis?.loudness));
  }

  private selectionContext(): SelectionContext {
    return {
      mood: this.mood,
      current: this.current?.track ?? null,
      currentBpm: this.currentBpm(),
      targetEnergy: targetEnergy(this.mood, this.moodTrackIndex),
      history: this.history,
      recentArtists: this.recentArtists,
      jump: this.jump,
    };
  }

  /**
   * Pick + decode the next track, skipping files that fail to decode. With
   * `useRequests`, staff requests come first (taken off the queue); the
   * auto-DJ's own picks never choose a track that is waiting in the queue.
   */
  private async loadNextTrack(ctx: SelectionContext, exclude: Set<string>, useRequests = false): Promise<Loaded | null> {
    const skip = new Set([...exclude, ...this.failed, ...this.requests.map((t) => t.id)]);
    while (useRequests && this.requests.length > 0) {
      const track = this.requests.shift()!;
      if (this.failed.has(track.id) || exclude.has(track.id) || track.id === this.current?.track.id) continue;
      const buffer = await this.decodeTrack(track);
      if (buffer) return { track, buffer, requested: true };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const track = pickNext(this.deps.getTracks(), ctx, skip);
      if (!track) return null;
      const buffer = await this.decodeTrack(track);
      if (buffer) return { track, buffer, requested: false };
      skip.add(track.id);
    }
    return null;
  }

  /** Decode a track for playback; on failure flag it and return null. */
  private async decodeTrack(track: Track): Promise<AudioBuffer | null> {
    try {
      const file = await this.deps.getFile(track);
      return await this.engine.decode(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not decode file";
      this.failed.add(track.id);
      this.deps.onTrackError(track.id, message);
      return null;
    }
  }

  private async planNext(): Promise<void> {
    if (!this.playing || !this.current || this.planned || this.planning || this.ejectHold) return;
    this.planning = true;
    const gen = this.generation;
    try {
      const exclude = new Set<string>(this.standby ? [this.standby.track.id] : []);
      const loaded = await this.loadNextTrack(this.selectionContext(), exclude, true);
      if (gen !== this.generation || !this.playing || !this.current || this.planned) {
        if (loaded?.requested) this.requests.unshift(loaded.track);
        return;
      }
      if (!loaded) {
        this.note = "Not enough playable tracks — add more music";
        this.emit();
        return;
      }
      const entry = (loaded.requested && this.requestEntries.get(loaded.track.id)) || { kind: "auto" as const };
      this.requestEntries.delete(loaded.track.id);
      if (this.paused || this.liveLooping()) this.hold(loaded.track, loaded.buffer, loaded.requested, entry);
      else this.schedule(loaded.track, loaded.buffer, loaded.requested, entry);
      void this.prepareStandby();
    } finally {
      this.planning = false;
    }
  }

  /**
   * Plan how `track` comes in. Two families:
   *  - Landing entries, where a point of the song lands on the beat: its drop
   *    (drop swap: build-up when tempos sync, else a cut with an echo tail) or,
   *    when it has a dialogue marker, its dialogue followed by a jump to the
   *    drop. Used for staff Drop, the set opener's auto-drop, Desi Night's
   *    songs (`holdForDrop`), peak-time drop swaps, and a "Start from" of
   *    dialogue / hook / drop.
   *  - Blends (blend, filter sweep, echo-out, cut) for everything else, from
   *    the song's default start or a "Start from" of beginning / bar.
   */
  private schedule(
    track: Track,
    buffer: AudioBuffer,
    requested = false,
    entry: EntryChoice = { kind: "auto" },
    opts: ScheduleOptions = {},
  ): void {
    const cur = this.current!;
    const a = cur.track.analysis!;
    const b = track.analysis!;
    const tl = cur.deck.timeline!;
    const now = this.engine.now;
    const mood = this.mood;
    const earliest = tl.positionAt(now + SCHEDULE_MARGIN);

    const curBpm = a.bpm * tl.rateAt(now);
    // The rate it settles at after its mix: staff's tempo slider, else its own tempo.
    const target = opts.tempo ?? 1;
    const staffDrop = this.dropRequested;
    this.dropRequested = false;
    // The song on air's cue out (track editor): its hand-over lands there instead of at its own mix-out point.
    const cueOut = cur.track.cues?.end;
    // No automatic mix with AI DJ off, or when staff touched either song: the whole song plays, then this one
    // starts (Drop or ▶ still mix by hand).
    const manual = (!this.auto || !!cur.touched || !!opts.touched) && !staffDrop && !opts.soon;
    const opener = this.openerEnd !== null && !manual;
    // Desi Night holds each song (after the opener) until Drop; it still leaves near the end on its own.
    const holding = (manual || !!mood.holdForDrop) && !opener && !staffDrop && !opts.soon;
    const planned: TransitionKind = chooseTransition(cur.track, track, curBpm, this.jump, mood.halfTime);
    const bars = planned === "blend" ? mood.blendBars : 8;
    // Bars from the transition's start to its hand-over, which should land
    // where the outgoing track breaks down: a blend's bass swap is halfway,
    // a filter sweep's crossover about halfway, an echo-out or cut at once.
    const leadBars = planned === "blend" ? Math.floor(bars / 2) : planned === "filterSweep" ? 4 : 0;
    const resolved = resolveEntry(track, entry);
    const hasDrop = !!b.barLevels && drops(b.barLevels, b.fullLevel).length > 0;
    const chosenLanding = entry.kind === "dialogue" || entry.kind === "hook" || entry.kind === "drop";
    // Peak-time moods swap onto the next track's drop where a blend would have
    // swapped basslines — only when the blend could beat-match and a drop exists.
    const autoSwap = planned === "blend" && mood.dropSwap && hasDrop;
    const landing = staffDrop || opener || !!mood.holdForDrop || chosenLanding || autoSwap;

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])], this.deckTarget);
    if (!inc) return;
    inc.load(track, buffer, this.loudnessTarget());

    if (manual) {
      // No mix: the whole song plays; the next one starts the moment it ends (nothing overlaps).
      const fs = firstStart(track, entry, false);
      const T = Math.max(now + 0.5, tl.timeAt(a.duration - 0.05));
      const plan = cut(cur.deck, inc, T);
      inc.start(T, fs.start, fs.jump ? 1 : target, fs.jump && { at: T + fs.jump.after, to: fs.jump.to });
      const timer = setTimeout(() => this.handover(), Math.max(0, (plan.end - this.engine.now) * 1000) + 60);
      this.planned = { deck: inc, track, plan, timer, requested, staffDrop: false, entry, startAt: fs.start, holding: false, fx: false, tempo: opts.tempo, manual: true, touched: opts.touched };
      this.emit();
      return;
    }

    let plan: TransitionPlan;
    let rate = 1;
    let synced = false;
    let startAt: number;
    // Outgoing beat length at the transition, and whether a riser is already on (for auto effects).
    let beat = 60 / curBpm;
    let riser = false;

    if (!landing) {
      // ▶ on the cued deck: the next phrase. Its mix paused by staff: over the outro.
      let mixPos = opts.soon
        ? nextBoundary(a, earliest, DROP_BOUNDARY_BARS)
        : opts.deferred || manual
          ? mixOutFor(a, cueOut, bars, earliest, undefined, leadBars)
          : mixOutFor(a, cueOut, bars, earliest, mood, leadBars);
      let t = tl.timeAt(mixPos);
      if (t < now + 1) {
        mixPos = nextDownbeat(a, earliest);
        t = tl.timeAt(mixPos);
      }
      const outBpm = a.bpm * tl.rateAt(t);
      const outBeat = 60 / outBpm;
      beat = outBeat;
      synced = planned === "blend" || planned === "filterSweep";
      // ×1, or ×2 / ×½ in half-time moods (each incoming beat spans two outgoing beats, or half of one).
      rate = synced ? outBpm / (b.bpm * (syncRatio(outBpm, b.bpm, mood.halfTime) ?? 1)) : target;
      startAt = entry.kind === "auto" ? defaultStart(track) : resolved.land;
      if (planned === "blend") plan = blend(cur.deck, inc, t, bars, outBeat);
      else if (planned === "filterSweep") plan = filterSweep(cur.deck, inc, t, outBeat);
      // A tempo jump: rewind moods spin the outgoing track back, others echo it out.
      else if (planned === "echoOut") plan = mood.rewind ? rewindInto(cur.deck, inc, t) : echoOut(cur.deck, inc, t, outBeat);
      else plan = cut(cur.deck, inc, t);
      inc.start(plan.start, startAt, rate);
    } else {
      // When the landing point (drop, or the dialogue's start) reaches the room.
      let T: number;
      if (staffDrop || opts.soon) T = tl.timeAt(nextBoundary(a, earliest, resolved.dialogue ? 1 : DROP_BOUNDARY_BARS));
      else if (opener) T = tl.timeAt(Math.max(this.openerEnd!, earliest));
      // Desi Night (or a mix staff paused): near the end of the song (the outro), unless Drop comes first.
      else if (mood.holdForDrop || opts.deferred || manual) T = tl.timeAt(mixOutFor(a, cueOut, 8, earliest, undefined, 0));
      // On the breakdown a blend's bass swap was aimed at.
      else T = tl.timeAt(mixOutFor(a, cueOut, bars, earliest, mood, leadBars) + leadBars * barSeconds(a));
      if (T < now + 1) T = tl.timeAt(nextDownbeat(a, earliest));
      const outBpm = a.bpm * tl.rateAt(T);
      const outBeat = 60 / outBpm;
      const outBar = 4 * outBeat;
      beat = outBeat;

      // Tempos too far apart to beat-match: rewind moods spin the outgoing track back first.
      const rewind = !!mood.rewind && syncRatio(outBpm, b.bpm, mood.halfTime) === null;
      if (resolved.dialogue) {
        // Dialogue in the clear, then straight to the drop (at the song's own tempo).
        const d = resolved.dialogue;
        const dialogueAt = rewind ? T + REWIND_LEAD : T;
        const dropAt = dialogueAt + (d.end - d.start);
        plan = rewind ? rewindInto(cur.deck, inc, T, "dialogue", dropAt) : dialogueIn(cur.deck, inc, T, dropAt, outBeat);
        startAt = d.start;
        inc.start(plan.start, d.start, 1, { at: dropAt, to: resolved.land });
      } else if (rewind) {
        // Spin back, then the drop hits at the song's own tempo.
        plan = rewindInto(cur.deck, inc, T);
        startAt = resolved.land;
        rate = target;
        inc.start(plan.start, startAt, rate);
        if (staffDrop || opener) riser = this.riser(Math.max(now + SCHEDULE_MARGIN, T - 2 * outBar), T, !staffDrop);
      } else {
        const ratio = syncRatio(outBpm, b.bpm, mood.halfTime);
        synced = ratio !== null;
        rate = ratio ? outBpm / (b.bpm * ratio) : target;
        const canBuild = synced && a.beatConfidence >= MIN_BLEND_CONFIDENCE && b.beatConfidence >= MIN_BLEND_CONFIDENCE;
        let land = T;
        let build = 0;
        if (canBuild) {
          // A staff Drop lands on a 4-bar boundary far enough ahead for a build-up.
          if (staffDrop || opts.soon) land = tl.timeAt(nextBoundary(a, tl.positionAt(now + SCHEDULE_MARGIN + MIN_DROP_BUILD_BARS * outBar), DROP_BOUNDARY_BARS));
          build = dropBuildBars(land - (now + SCHEDULE_MARGIN), outBar, resolved.land, rate, MAX_DROP_BUILD_BARS);
          // At half tempo one incoming bar spans two outgoing bars: keep the build whole incoming bars.
          if (ratio === 2) build = Math.floor(build / 2) * 2;
        }
        // outBar × rate is one incoming bar, so the offset stays on the incoming grid.
        startAt = resolved.land - build * outBar * rate;
        plan = dropIn(cur.deck, inc, land - build * outBar, land, outBeat);
        inc.start(plan.start, startAt, rate);
        // A staff Drop or the opener's auto-drop gets a noise riser that peaks as the drop hits.
        if (staffDrop || opener) riser = this.riser(build > 0 ? plan.start : Math.max(now + SCHEDULE_MARGIN, land - 2 * outBar), land, !staffDrop);
      }
    }

    if (synced && Math.abs(rate - target) > 0.001) {
      const handBack = TEMPO_HANDBACK_BARS * 4 * (60 / (a.bpm * tl.rateAt(plan.start)));
      inc.rampRate(plan.end, plan.end + handBack, target);
    }
    // The outgoing deck is silent from plan.end; handover() stops and unloads it.

    const fx = mood.autoFx ? this.transitionFx(plan, beat, riser) : false;
    const timer = setTimeout(() => this.handover(), Math.max(0, (plan.end - this.engine.now) * 1000) + 60);
    this.planned = { deck: inc, track, plan, timer, requested, staffDrop, entry, startAt, holding, fx, deferred: opts.deferred, tempo: opts.tempo, manual, touched: opts.touched };
    this.emit();
  }

  /** While paused: load the next song on a free deck without scheduling anything (it's planned on ▶). */
  private hold(track: Track, buffer: AudioBuffer, requested: boolean, entry: EntryChoice, touched = false): void {
    const cur = this.current!;
    const deck = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])], this.deckTarget);
    if (!deck) return;
    deck.load(track, buffer, this.loudnessTarget());
    deck.resetControls(0);
    const timer = setTimeout(() => undefined, 0);
    this.planned = {
      deck,
      track,
      plan: HELD_PLAN,
      timer,
      requested,
      staffDrop: false,
      entry,
      startAt: startOf(track, entry),
      holding: false,
      fx: false,
      held: true,
      touched,
    };
    this.emit();
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  /** A noise riser peaking at deck time `to`; false if there's under a second for it. */
  private riser(from: number, to: number, auto: boolean): boolean {
    if (to - from <= 1) return false;
    const delay = this.engine.outputDelay;
    this.noteFx("riser", from + delay, this.engine.fx.riserBetween(from + delay, to + delay), auto);
    return true;
  }

  /**
   * Effects the auto-DJ adds to a transition (moods with `autoFx`), timed on
   * the outgoing beat and heard on the master: a reverb or echo throw at a
   * blend's bass swap (alternating), a riser and a closing filter into a
   * drop, a reverb wash on a cut. Dialogue drops and rewinds stay clean.
   * Returns whether anything was scheduled.
   */
  private transitionFx(plan: TransitionPlan, beat: number, riserOn: boolean): boolean {
    const fx = this.engine.fx;
    const delay = this.engine.outputDelay;
    const at = (t: number) => t + delay;
    switch (plan.kind) {
      case "blend": {
        const swap = (plan.start + plan.end) / 2;
        const kind: FxKind = this.moodTrackIndex % 2 ? "reverb" : "echo";
        this.noteFx(kind, at(swap - beat), fx.trigger(kind, at(swap - beat), beat), true);
        return true;
      }
      case "drop": {
        if (plan.drop === undefined) return false;
        if (!riserOn && plan.drop - plan.start > 2) {
          this.noteFx("riser", at(plan.start), fx.riserBetween(at(plan.start), at(plan.drop)), true);
        }
        const from = Math.max(this.engine.now + 0.2, plan.drop - 4 * beat);
        this.noteFx("filter", at(from), fx.filterInto(at(from), at(plan.drop)), true);
        return true;
      }
      case "cut":
        this.noteFx("reverb", at(plan.start), fx.trigger("reverb", at(plan.start), beat), true);
        return true;
      default:
        return false;
    }
  }

  /** The re-planned transition's effects: cancel them (and their FX-pad windows). */
  private cancelTransitionFx(p: Planned): void {
    if (!p.fx && p.plan.kind !== "drop" && p.plan.kind !== "rewind") return;
    this.engine.fx.cancelScheduled();
    const now = this.engine.now;
    this.fxWindows = this.fxWindows.filter((w) => w.end <= now);
  }

  private noteFx(kind: FxKind, start: number, end: number, auto: boolean): void {
    const now = this.engine.now;
    this.fxWindows = [...this.fxWindows.filter((w) => w.end > now), { kind, start, end, auto }];
  }

  /**
   * ▶ Play now: `track` plays together with the song on air, both at full level — at once, on the song on
   * air's next beat and in the same place in the bar when the two can be beat-matched (else right away at its
   * own tempo); with `alone` (the song on air is paused) right away. Nothing mixes or swaps until Drop or one of
   * them ends (`rearmPair`).
   */
  private scheduleLayer(
    track: Track,
    buffer: AudioBuffer,
    requested: boolean,
    entry: EntryChoice,
    opts: { tempo?: number; alone?: boolean; quiet?: boolean } = {},
  ): void {
    const cur = this.current!;
    const a = cur.track.analysis!;
    const b = track.analysis!;
    const tl = cur.deck.timeline!;
    const now = this.engine.now;
    const ratio = opts.alone ? null : syncRatio(a.bpm * tl.rateAt(now), b.bpm, this.mood.halfTime);
    const synced = ratio !== null && a.beatConfidence >= MIN_BLEND_CONFIDENCE && b.beatConfidence >= MIN_BLEND_CONFIDENCE;
    const t = synced ? tl.timeAt(nextBoundary(a, tl.positionAt(now + 0.12), 1 / BEATS_PER_BAR)) : now + 0.05;
    const rate = synced ? (a.bpm * tl.rateAt(t)) / (b.bpm * ratio!) : (opts.tempo ?? 1);
    let startAt =
      entry.kind === "auto"
        ? defaultStart(track)
        : entry.kind === "dialogue"
          ? (resolveEntry(track, entry).dialogue?.start ?? resolveEntry(track, entry).land)
          : resolveEntry(track, entry).land;

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])], this.deckTarget);
    if (!inc) return;
    inc.load(track, buffer, this.loudnessTarget());
    // In time with the song on air: from the same beat of the bar as the song on air is on at `t`.
    if (synced) {
      const beatB = 60 / b.bpm;
      const kA = gridPosition(a, tl.positionAt(t) + 1e-3).beat;
      startAt = b.firstBeat + Math.round((startAt - b.firstBeat) / beatB) * beatB + kA * beatB;
    }
    inc.resetControls(0);
    inc.fader.gain.setValueAtTime(0, t);
    inc.fader.gain.linearRampToValueAtTime(1, t + 0.05);
    inc.start(t, Math.max(0, Math.min(b.duration - 1, startAt)), rate);
    // A loop armed on it: it comes in looping, until Drop or Exit.
    this.applyArmed(inc, track);
    this.planned = {
      deck: inc,
      track,
      plan: { kind: "layer", start: t, end: Number.POSITIVE_INFINITY },
      timer: setTimeout(() => undefined, 0),
      requested,
      staffDrop: false,
      entry,
      startAt,
      holding: false,
      fx: false,
      tempo: opts.tempo,
      layer: { rate, together: true, incFull: true },
      touched: true,
    };
    this.rearmPair(this.planned);
    if (!opts.quiet) this.note = `${track.title} plays along — both decks play until you press Drop or a song ends`;
    this.emit();
  }

  /** End a layer: swap the basslines on the next 4-bar phrase (or `at`, the new song's drop) and let the old song fade. */
  private finishLayer(at?: number): boolean {
    const p = this.planned;
    const cur = this.current;
    if (!p?.layer || p.plan.drop !== undefined || !cur?.deck.timeline || !this.playing) return false;
    // The song playing along is paused: it comes back now (it's about to take over).
    if (this.pausedAlong) {
      const state = this.pausedAlong;
      this.pausedAlong = null;
      if (this.paused) this.startNow(p.deck, p.track, state, 0.05);
      else this.resumeSynced(p.deck, p.track, state, cur);
      p.layer.incFull = true;
    }
    // The new song plays on after the swap.
    clearTimeout(p.layer.endTimer);
    this.endLoopOn(p.deck);
    const a = cur.track.analysis!;
    const tl = cur.deck.timeline;
    const now = this.engine.now;
    // Not before the layer has actually started.
    const from = Math.max(now + SCHEDULE_MARGIN, p.plan.start + 0.1);
    const t = at !== undefined && at >= from ? at : tl.timeAt(nextBoundary(a, tl.positionAt(from), DROP_BOUNDARY_BARS));
    const outBeat = 60 / (a.bpm * tl.rateAt(t));
    clearTimeout(p.timer);
    p.plan = layerSwap(cur.deck, p.deck, p.plan.start, t, outBeat, !!p.layer.incFull);
    // Then the new song glides to its own tempo (or staff's tempo for it).
    const target = p.tempo ?? 1;
    if (Math.abs(p.layer.rate - target) > 0.001) {
      p.deck.rampRate(p.plan.end, p.plan.end + TEMPO_HANDBACK_BARS * 4 * outBeat, target);
    }
    if (this.mood.autoFx) {
      const delay = this.engine.outputDelay;
      this.noteFx("reverb", t - outBeat + delay, this.engine.fx.trigger("reverb", t - outBeat + delay, outBeat), true);
    }
    p.timer = setTimeout(() => this.handover(), Math.max(0, (p.plan.end - this.engine.now) * 1000) + 60);
    this.note = null;
    this.emit();
    return true;
  }

  private handover(): void {
    const p = this.planned;
    const prev = this.current;
    if (!p || !this.playing) return;
    this.planned = null;
    // A loop armed on the cued song doesn't apply when the auto-DJ mixed it in by itself.
    this.armed.delete(p.track.id);
    if (prev) this.armed.delete(prev.track.id);
    if (this.cueHeld?.deck === prev?.deck) this.cueHeld = null;
    // The song going out was paused: it is gone now; the new one plays on.
    if (this.paused && prev && this.paused.deck === prev.deck) {
      this.paused = null;
      this.startWatchdog();
    }
    this.pausedAlong = null;
    if (prev) {
      this.loops.delete(prev.deck);
      prev.deck.resetControls(0);
      prev.deck.unload();
    }
    // Drops and filter sweeps leave the incoming filter at an inaudible extreme.
    p.deck.clearFilter();
    // The opener has dropped into the party: its note is done.
    if (this.openerEnd !== null) this.note = null;
    this.openerEnd = null;
    this.current = { deck: p.deck, track: p.track, startedAt: p.plan.start, from: p.startAt, touched: !!p.touched };
    this.remember(p.track);
    this.deps.onPlayed?.(p.track, p.plan.kind, p.requested, this.mood.id);
    if (this.jump) this.jump = false;
    // After a staff request outside the mood's tempo, steer the next pick back into the mood.
    if (p.requested && isMoodJump(this.currentBpm(), this.mood)) {
      this.jump = true;
      this.note = `Back to ${this.mood.name} after this request`;
    }
    if (this.moodTracksLeft > 0 && --this.moodTracksLeft === 0) this.note = null;
    this.emit();
    void this.planNext();
  }

  private cancelPlanned(): void {
    const p = this.planned;
    if (!p) return;
    clearTimeout(p.timer);
    clearTimeout(p.layer?.endTimer);
    this.loops.delete(p.deck);
    this.pausedAlong = null;
    p.deck.unload();
    p.deck.resetControls(0);
    this.planned = null;
    // A re-plan must not lose a staff request (or how it comes in), nor keep effects aimed at the old mix.
    if (p.requested) {
      this.requests.unshift(p.track);
      this.requestEntries.set(p.track.id, p.entry);
    }
    this.cancelTransitionFx(p);
    // Only called before the transition starts: drop the outgoing deck's
    // scheduled automation and keep it playing at full level.
    this.current?.deck.resetControls(1);
  }

  private remember(track: Track): void {
    this.history.unshift(track.id);
    this.history.length = Math.min(this.history.length, 200);
    if (track.artist) this.recentArtists.unshift(track.artist);
    this.recentArtists.length = Math.min(this.recentArtists.length, 20);
    this.moodTrackIndex++;
  }

  // ── Fail-safes ───────────────────────────────────────────────────────────────

  /** With 3+ decks, keep one extra track decoded so recovery is instant. */
  private async prepareStandby(): Promise<void> {
    if (this.deckTarget < 3 || this.standby || !this.playing) return;
    const gen = this.generation;
    const exclude = new Set([this.current?.track.id, this.planned?.track.id].filter((x): x is string => !!x));
    const loaded = await this.loadNextTrack(this.selectionContext(), exclude);
    if (!loaded || gen !== this.generation || !this.playing || this.standby) return;
    const used = [this.current?.deck, this.planned?.deck].filter((d): d is Deck => !!d);
    const deck = this.engine.freeDeck(used, this.deckTarget);
    if (!deck) return;
    deck.load(loaded.track, loaded.buffer, this.loudnessTarget());
    this.standby = { deck, track: loaded.track };
    this.emit();
  }

  private dropStandby(): void {
    if (this.standby) {
      this.standby.deck.unload();
      this.standby = null;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.silentSince = null;
    this.watchdog = setInterval(() => {
      if (!this.playing || this.recovering || !this.current || this.paused) return;
      const now = this.engine.now;
      if (now - this.current.startedAt < START_GRACE_SECONDS) return;
      // Staff turned the song on air down (channel fader or crossfader): that silence is theirs, not a failure.
      if (this.engine.channelGain(this.current.deck.index) < STAFF_MUTED) {
        this.silentSince = null;
        return;
      }
      if (this.engine.peak() < SILENCE_LEVEL) {
        this.silentSince ??= now;
        if (now - this.silentSince > SILENCE_SECONDS) void this.recover("silence detected");
      } else {
        this.silentSince = null;
      }
    }, 500);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** Get music playing again immediately, whatever went wrong. */
  private async recover(reason: string): Promise<void> {
    if (this.recovering || !this.playing) return;
    this.recovering = true;
    this.generation++;
    const gen = this.generation;
    try {
      if (this.planned) {
        clearTimeout(this.planned.timer);
        clearTimeout(this.planned.layer?.endTimer);
        this.planned.deck.unload();
        if (this.planned.requested) this.requests.unshift(this.planned.track);
        this.planned = null;
      }
      let next: Loaded | null = null;
      let deck: Deck | null = null;
      if (this.standby?.deck.buffer) {
        next = { track: this.standby.track, buffer: this.standby.deck.buffer, requested: false };
        deck = this.standby.deck;
        this.standby = null;
      } else {
        const exclude = new Set(this.current ? [this.current.track.id] : []);
        next = await this.loadNextTrack(this.selectionContext(), exclude, true);
      }
      if (gen !== this.generation || !this.playing) return;
      if (!next) {
        this.error = "Playback stopped: no playable tracks";
        this.emit();
        return;
      }
      for (const d of this.engine.decks) {
        if (d !== deck) {
          d.unload();
          d.resetControls(0);
        }
      }
      deck ??= this.engine.decks[0];
      if (!deck.buffer) deck.load(next.track, next.buffer, this.loudnessTarget());
      deck.resetControls(1);
      const when = this.engine.now + 0.05;
      this.openerEnd = null;
      deck.start(when, defaultStart(next.track), 1);
      this.pausedAlong = null;
      this.cueHeld = null;
      this.endEjectHold();
      this.current = { deck, track: next.track, startedAt: when, from: defaultStart(next.track) };
      this.remember(next.track);
      this.deps.onPlayed?.(next.track, "recovery", next.requested, this.mood.id);
      this.silentSince = null;
      this.note = `Recovered automatically (${reason})`;
      this.emit();
      void this.planNext();
    } finally {
      this.recovering = false;
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  /** Live, read-only view of the decks for the booth display. Never changes the mix. */
  snapshot(): BoothSnapshot {
    // What the room hears now: deck times lag by the key-lock delay and the output's own latency.
    const now = this.engine.now - this.engine.displayDelay;
    const p = this.planned;
    const liveTl = this.current?.deck.timeline;
    return {
      now,
      decks: this.engine.decks.map((d) =>
        d.track && d.timeline
          ? {
              started: now >= d.timeline.startTime,
              startsAt: d.timeline.startTime,
              // A paused deck stands still where it stopped.
              // A paused deck stands still where it stopped.
              position:
                this.paused?.deck === d
                  ? this.paused.position
                  : this.pausedAlong && this.planned?.deck === d
                    ? this.pausedAlong.position
                    : d.timeline.positionAt(now),
              rate:
                this.paused?.deck === d
                  ? this.paused.rate
                  : this.pausedAlong && this.planned?.deck === d
                    ? this.pausedAlong.rate
                    : d.timeline.rateAt(now),
              fader: d.fader.gain.value,
              bassDb: d.low.gain.value,
              midDb: d.mid.gain.value,
              highDb: d.high.gain.value,
              trimDb: 20 * Math.log10(Math.max(1e-4, d.trim.gain.value)),
              cfx: d.filterPosition(),
              level: d.level(),
            }
          : null,
      ),
      mix: p && !p.held ? { start: p.plan.start, end: p.plan.end, drop: p.plan.drop } : null,
      loops: this.loopList().map(({ deck, start, end, armed }) => ({ deck, start, end, armed })),
      // (AI DJ off: no mix point — the song plays to its end.)
      mixOutPosition: p && !p.held && !p.manual && liveTl ? liveTl.positionAt(p.plan.start) : null,
      dropLocked: this.current?.deck.pendingJump(this.engine.now) != null,
      layering: !!p?.layer && p.plan.drop === undefined && this.engine.now >= p.plan.start,
      activeFx: this.fxWindows
        .filter((w) => w.start <= this.engine.now && this.engine.now < w.end)
        .map(({ kind, auto }) => ({ kind, auto })),
    };
  }

  /** Loops playing, and those armed on stopped songs, for the booth. */
  private loopList(): AutoDJStatus["loops"] {
    const list: AutoDJStatus["loops"] = [...this.loops].map(([d, l]) => ({ deck: d.index, beats: l.beats, start: l.start, end: l.end, armed: false }));
    for (const d of this.engine.decks) {
      const l = d.track ? this.armed.get(d.track.id) : undefined;
      if (l && !this.loops.has(d)) list.push({ deck: d.index, beats: l.beats, start: l.start, end: l.end, armed: true });
    }
    return list;
  }

  private emit(): void {
    // Fewer decks wanted: drop the extra ones once they're free (checked at every change).
    this.trimDecks();
    const c = this.current;
    const p = this.planned;
    this.deps.onStatus({
      playing: this.playing,
      mood: this.mood.id,
      now: c
        ? {
            track: c.track,
            deck: c.deck.index,
            bpm: Math.round((this.currentBpm() ?? c.track.analysis?.bpm ?? 0) * 10) / 10,
            startedAt: c.startedAt,
          }
        : null,
      next: p
        ? {
            track: p.track,
            deck: p.deck.index,
            transition: p.plan.kind,
            at: p.plan.start,
            requested: p.requested,
            entry: p.entry,
            startAt: p.startAt,
            holding: p.holding,
            tempo: p.tempo ?? null,
            together: p.layer?.together ? { swapAt: p.layer.swapAt ?? null } : null,
            afterSong: !!p.manual && !p.held,
          }
        : null,
      queue: [...this.requests],
      standby: this.standby ? { track: this.standby.track, deck: this.standby.deck.index } : null,
      note: this.note,
      error: this.error,
      deckCount: this.engine.decks.length,
      keyLock: this.keyLockReady,
      paused: this.paused?.deck.index ?? null,
      holding: this.paused?.hold ? this.paused.deck.index : this.pausedAlong?.hold && p ? p.deck.index : null,
      pausedAlong: this.pausedAlong && p ? p.deck.index : null,
      // (A song playing along that is about to start counts as playing.)
      silent: !!this.paused && (!p || p.held || !p.layer || !!this.pausedAlong),
      loops: this.loopList(),
      cuePoints: this.engine.decks.map((d) => (d.track && (d === c?.deck || d === p?.deck) ? this.cueAt(d) : null)),
      cueHeld: this.cueHeld?.deck.index ?? null,
      auto: this.auto,
    });
  }
}
