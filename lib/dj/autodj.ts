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
import type { FxKind } from "@/lib/audio/fx";
import { libraryLoudness } from "@/lib/analysis/loudness";
import {
  blend,
  cut,
  dialogueIn,
  dropIn,
  echoOut,
  filterSweep,
  layerIn,
  layerSwap,
  REWIND_LEAD,
  rewindInto,
  type TransitionPlan,
} from "@/lib/audio/transitions";
import { MAX_DECKS, MIN_DECKS, type EntryChoice, type Mood, type MoodId, type Track, type TransitionKind } from "@/lib/types";
import { defaultStart, firstStart, layerEntry, openerWindow, resolveEntry, type FirstStart } from "./cues";
import { getMood, targetEnergy } from "./moods";
import { drops } from "@/lib/analysis/structure";
import { barSeconds, BEATS_PER_BAR, dropBuildBars, mixOutPoint, nextBoundary, nextDownbeat } from "./mixpoints";
import {
  canLayer,
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
  /** It can be layered over the playing song now (tempo and key match). */
  layerable: boolean;
  /** Staff's tempo for it after its mix (playback rate), or null for its own tempo. */
  tempo: number | null;
  /** ▶ Play now: playing together with the song on air; they swap at this context time (its drop), or on Drop. */
  together: { swapAt: number | null } | null;
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
  /** That pause is a hand on the jog wheel (a scratch): it plays on when let go. */
  holding: boolean;
  /** A beat loop on the song on air (its deck and length in beats); the cued mix waits for it. */
  loop: { deck: number; beats: number } | null;
  /** AI DJ mode: on, the auto-DJ mixes by itself; off, staff mix with Drop / ▶ Play now (it takes over near the end). */
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
}

/** A deck loaded before Play: its song and how it should start / come in. */
export interface Preload {
  track: Track;
  entry: EntryChoice;
}

/** What staff loaded before Play: Deck A plays first, the rest come in order after it. */
export interface StartPreset {
  first?: Preload;
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
  /** A beat loop on the song on air (track seconds). */
  loop: { deck: number; start: number; end: number } | null;
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
    swapAt?: number;
  };
  /** The set is paused: the song is loaded on its deck but nothing is scheduled (`plan` is HELD_PLAN). */
  held?: boolean;
  /** Staff paused this song during its mix: it comes in again near the end of the current song. */
  deferred?: boolean;
  /** Staff's tempo slider on the cued deck: the playback rate it settles at after its mix (else 1). */
  tempo?: number;
  /** Planned with AI DJ off: it waits for Drop, and mixes by itself only near the end of the song. */
  manual?: boolean;
}

/** How `schedule` times a transition. */
interface ScheduleOptions {
  /** Staff pressed ▶ on the cued deck: mix it in on the next phrase. */
  soon?: boolean;
  /** Near the end of the current song (after staff paused this one's mix). */
  deferred?: boolean;
  /** The rate it settles at after its mix (staff's tempo slider), else its own tempo. */
  tempo?: number;
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
  private current: { deck: Deck; track: Track; startedAt: number } | null = null;
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
  /** A beat loop on the song on air (track seconds; `beats` its length). */
  private looping: { deck: Deck; start: number; end: number; beats: number } | null = null;
  /** AI DJ mode (see AutoDJStatus.auto). */
  private auto = true;
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
      if (this.playing && !this.paused && this.current?.deck === d) void this.recover("track ended early");
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
    const deck = this.engine.decks[0];
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
    this.current = { deck, track: first.track, startedAt: when };
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
    this.looping = null;
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
    if (!this.playing || !this.current || this.recovering || this.paused) return false;
    // Loop, then drop: the loop ends and the next song comes in on its drop.
    this.endLoop();
    // Two songs layered: Drop swaps them.
    if (this.planned?.layer) return this.finishLayer();
    // The live song is still in its dialogue: let it reach its drop first.
    if (this.current.deck.pendingJump() !== null) return false;
    const p = this.planned;
    if (p && p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return false;
    if (p?.staffDrop) return true;
    this.dropRequested = true;
    const up = this.unplan();
    if (up) this.schedule(up.track, up.buffer, up.requested, up.entry, { tempo: up.tempo });
    // Still choosing / decoding: schedule() picks the request up.
    else void this.planNext();
    return true;
  }

  /**
   * Staff pressed Layer: from the next phrase, `track` (default: the cued
   * song) plays over the current one, beat-matched, its bass off, until Drop
   * swaps them (or, if nobody does, before either song runs out). Only songs
   * that match in tempo and key (`canLayer`); false otherwise, or while a mix
   * or a dialogue is under way.
   */
  layer(track?: Track): boolean {
    const cur = this.current;
    if (!this.playing || !cur || this.recovering || this.planning || this.paused || cur.deck.pendingJump() !== null) return false;
    const p = this.planned;
    if (p && (p.layer || p.plan.start <= this.engine.now + SCHEDULE_MARGIN)) return false;
    const target = track ?? p?.track;
    const curBpm = this.currentBpm();
    if (!target || curBpm === null || !canLayer(cur.track, target, curBpm, this.mood.halfTime)) return false;
    this.endLoop();
    const up = this.unplan();
    if (up && up.track.id === target.id) {
      this.scheduleLayer(up.track, up.buffer, up.requested, up.entry);
      return true;
    }
    // A different song: the cued one goes back to the queue if staff asked for it.
    if (up?.requested) {
      this.requests.unshift(up.track);
      this.requestEntries.set(up.track.id, up.entry);
    }
    this.requests = this.requests.filter((t) => t.id !== target.id);
    const gen = this.generation;
    this.planning = true;
    void this.decodeTrack(target)
      .then((buffer) => {
        if (gen !== this.generation || !this.playing || this.planned) return;
        if (buffer) this.scheduleLayer(target, buffer, true, { kind: "auto" });
        else void this.planNext();
      })
      .finally(() => {
        this.planning = false;
        if (!this.planned) void this.planNext();
      });
    return true;
  }

  /**
   * Staff chose where the cued song comes in (booth "Start from"). Re-plans
   * the cued transition; ignored once it is under way.
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
    if (p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return false;
    this.dropRequested = p.staffDrop;
    const up = this.unplan();
    if (!up) return false;
    this.schedule(up.track, up.buffer, up.requested, choice, { deferred: up.deferred, tempo: up.tempo });
    return true;
  }

  // ── Deck play / pause (owner decision of 14 Oct 2026) ──────────────────────

  /**
   * Staff pressed ⏸ on a deck.
   *  - The song on air, with no mix sounding: it fades out in 60 ms and the
   *    club hears nothing until ▶ (the auto-DJ waits: no watchdog, nothing
   *    scheduled; the cued song stays loaded).
   *  - During a mix, the outgoing song: it stops and the incoming one carries
   *    on alone (the mix ends now).
   *  - During a mix, the incoming song: it stops and the outgoing one carries
   *    on alone; the same song comes in again near the end of the current one
   *    (▶ on it brings it in sooner).
   */
  pauseDeck(index: number, hold = false): boolean {
    const cur = this.current;
    if (!this.playing || !cur || this.recovering || this.paused) return false;
    // A pause (or a hand on the wheel) lets the loop go; the song carries on from there afterwards.
    if (cur.deck.index === index) this.endLoop();
    const p = this.planned;
    const now = this.engine.now;
    const mixing = !!p && !p.held && now >= p.plan.start;
    if (cur.deck.index === index) {
      // A hand on the jog wheel during a mix would throw both songs out of time: not then.
      if (mixing) return hold ? false : this.takeOver(p!);
      // The cued mix hasn't started: hold it (nothing may start while the club is silent).
      if (p) this.holdPlanned(p);
      const fade = hold ? HOLD_FADE : PAUSE_FADE;
      const position = cur.deck.position(now + fade);
      // Paused in a dialogue: after ▶ it still jumps to the drop where the dialogue ends.
      const tl = cur.deck.timeline;
      const at = cur.deck.pendingJump(now + fade);
      const jump = tl?.jump && at !== null ? { from: tl.positionAt(at - 1e-4), to: tl.jump.to } : undefined;
      // It plays on at the tempo it was at (or heading for, mid-glide).
      const rate = tl?.ramp && tl.ramp.t1 > now ? tl.ramp.r1 : (tl?.rateAt(now) ?? 1);
      cur.deck.resetControls(cur.deck.fader.gain.value);
      cur.deck.fadeOutAndStop(fade);
      this.paused = { deck: cur.deck, position, rate, jump, hold };
      this.stopWatchdog();
      this.dropStandby();
      if (!hold) this.note = null;
      this.emit();
      return true;
    }
    if (p && mixing && p.deck.index === index) {
      this.cancelMix(p);
      return true;
    }
    return false;
  }

  /**
   * Staff pressed ▶ on a deck.
   *  - The paused song: it carries on from where it stopped, fading in, and
   *    the auto-DJ plans the next mix again.
   *  - The cued song while the set is paused: it starts now (fading in) and
   *    the paused one is done.
   *  - The cued song while the set plays: the auto-DJ mixes it in on the next
   *    phrase (beat-matched blend, or onto its drop / dialogue if that is how
   *    it comes in) instead of waiting for the planned mix point.
   */
  /**
   * The jog wheel moved the paused (or hand-held) song to `position`: ▶ (or
   * letting go) plays on from there. Before a dialogue's end it still jumps to
   * the drop; after it, it plays straight on.
   */
  movePaused(position: number): boolean {
    const p = this.paused;
    const a = this.current?.track.analysis;
    if (!p || !a) return false;
    p.position = Math.max(0, Math.min(a.duration - 1, position));
    if (p.jump && p.position >= p.jump.from) p.jump = undefined;
    this.emit();
    return true;
  }

  playDeck(index: number, fade = RESUME_FADE): boolean {
    const cur = this.current;
    if (!this.playing || !cur || this.recovering) return false;
    const p = this.planned;
    const now = this.engine.now;
    if (this.paused) {
      if (index === this.paused.deck.index) {
        const { deck, position, rate, jump } = this.paused;
        const a = this.current?.track.analysis;
        const held = p?.held ? this.unplan() : null;
        this.paused = null;
        const when = now + 0.05;
        deck.resetControls(0);
        deck.start(when, position, rate, jump && { at: when + (jump.from - position) / rate, to: jump.to });
        deck.fader.gain.setValueAtTime(0, when);
        deck.fader.gain.linearRampToValueAtTime(1, when + fade);
        // Moved right up to the song's end: let the auto-DJ take over as if it had ended.
        if (a && position > a.duration - 2) void this.recover("end of song");
        this.startWatchdog();
        if (held) this.schedule(held.track, held.buffer, held.requested, held.entry, { deferred: held.deferred, tempo: held.tempo });
        else void this.planNext();
        this.emit();
        return true;
      }
      if (!p?.held || p.deck.index !== index || !p.deck.buffer) return false;
      // Start the cued song now; the paused one is over.
      const deck = p.deck;
      const up = this.unplan()!;
      cur.deck.unload();
      cur.deck.resetControls(0);
      this.paused = null;
      const when = now + 0.05;
      const fs = firstStart(up.track, up.entry, false);
      deck.resetControls(0);
      deck.start(when, fs.start, fs.jump ? 1 : (up.tempo ?? 1), fs.jump && { at: when + fs.jump.after, to: fs.jump.to });
      deck.fader.gain.setValueAtTime(0, when);
      deck.fader.gain.linearRampToValueAtTime(1, when + RESUME_FADE);
      this.current = { deck, track: up.track, startedAt: when };
      this.remember(up.track);
      this.deps.onPlayed?.(up.track, "start", up.requested, this.mood.id);
      if (this.jump) this.jump = false;
      this.startWatchdog();
      this.emit();
      void this.planNext();
      return true;
    }
    // ▶ Play now while a song is on air (not during a mix, a layer or its dialogue).
    this.endLoop();
    if (!p || p.layer || p.deck.index !== index || p.plan.start <= now + SCHEDULE_MARGIN) return false;
    if (cur.deck.pendingJump() !== null) return false;
    const a = cur.track.analysis!;
    const b = p.track.analysis!;
    const curBpm = this.currentBpm() ?? a.bpm;
    // Both songs can be beat-matched: they play together from the next phrase until its drop (or Drop).
    // (Set to start from its drop, it is already there: it swaps straight in instead.)
    const together =
      p.entry.kind !== "drop" &&
      syncRatio(curBpm, b.bpm, this.mood.halfTime) !== null &&
      a.beatConfidence >= MIN_BLEND_CONFIDENCE &&
      b.beatConfidence >= MIN_BLEND_CONFIDENCE;
    const up = this.unplan();
    if (!up) return false;
    // Too far apart in tempo to play in time together: mix it in on the next phrase instead.
    if (together) this.scheduleLayer(up.track, up.buffer, up.requested, up.entry, { together: true, tempo: up.tempo });
    else this.schedule(up.track, up.buffer, up.requested, up.entry, { soon: true, tempo: up.tempo });
    return true;
  }

  /**
   * Staff moved a deck's tempo slider (playback rate, within ±MAX_TEMPO).
   *  - The song on air: it glides there at once (key-lock keeps its key) and the
   *    cued mix is re-planned for the new tempo once the slider rests. Paused:
   *    it plays on at that tempo.
   *  - The cued song: the tempo it settles at after its mix (during the mix it
   *    is still beat-matched to the song on air).
   * Refused while that deck's mix is under way or about to start.
   */
  setDeckTempo(index: number, rate: number): boolean {
    const cur = this.current;
    if (!this.playing || !cur || this.recovering) return false;
    const r = Math.max(1 - MAX_TEMPO, Math.min(1 + MAX_TEMPO, rate));
    const p = this.planned;
    const now = this.engine.now;
    const busy = !!p && !p.held && now >= p.plan.start - SCHEDULE_MARGIN - 1;
    if (cur.deck.index === index) {
      if (this.paused?.deck === cur.deck) {
        this.paused.rate = r;
        this.emit();
        return true;
      }
      if (busy) return false;
      cur.deck.changeRate(r);
      this.replanSoon();
      this.emit();
      return true;
    }
    if (p && p.deck.index === index && !busy) {
      p.tempo = Math.abs(r - 1) < 0.0005 ? undefined : r;
      if (!p.held) this.replanSoon();
      this.emit();
      return true;
    }
    return false;
  }

  /**
   * Beat loop on the song on air: `beats` long (¼ … 16), starting on the beat
   * the playhead is in (so it plays on to the loop's end and wraps, on the
   * grid). Pressed while looping, it resizes the loop from the same start. The
   * cued mix waits (held) until the loop ends. Refused during a mix (or just
   * before one), while paused and while the song is still in its dialogue.
   */
  loop(index: number, beats: number): boolean {
    const cur = this.current;
    const a = cur?.track.analysis;
    if (!this.playing || !cur || !a || cur.deck.index !== index || this.paused || this.recovering) return false;
    const p = this.planned;
    const now = this.engine.now;
    if (p && !p.held && p.plan.start <= now + SCHEDULE_MARGIN + 1) return false;
    const tl = cur.deck.timeline;
    if (!tl || cur.deck.pendingJump() !== null) return false;
    const beat = 60 / a.bpm;
    const length = beats * beat;
    const pos = tl.positionAt(now + 0.03);
    let start = this.looping ? this.looping.start : a.firstBeat + Math.floor((pos - a.firstBeat) / beat) * beat;
    // Short loops: the first loop-length step that is still ahead of the playhead.
    while (start + length <= pos + 0.02) start += length;
    const end = Math.min(a.duration - 0.05, start + length);
    if (end <= pos || !cur.deck.setLoop(start, end)) return false;
    if (p && !p.held) this.holdPlanned(p);
    this.looping = { deck: cur.deck, start, end, beats };
    this.emit();
    return true;
  }

  /** Let the loop go: the song plays on, and the cued mix is planned again from there. */
  exitLoop(index: number): boolean {
    if (!this.looping || this.looping.deck.index !== index) return false;
    this.endLoop();
    const p = this.planned;
    const up = p?.held && !this.paused ? this.unplan() : null;
    if (up) this.schedule(up.track, up.buffer, up.requested, up.entry, { deferred: up.deferred, tempo: up.tempo });
    else if (!p) void this.planNext();
    this.emit();
    return true;
  }

  /** End a loop without re-planning (the caller plans what comes next). */
  private endLoop(): void {
    if (!this.looping) return;
    this.looping.deck.clearLoop();
    this.looping = null;
  }

  /**
   * AI DJ mode. Off: the auto-DJ still picks and cues the next song (and
   * beat-matches whatever staff bring in) but doesn't mix by itself — Up next
   * waits for Drop or ▶ Play now; if nobody mixes, it comes in near the end of
   * the song and AI DJ switches back on. On: back to mixing by itself. A cued mix
   * that hasn't started is re-planned for the new mode.
   */
  setAuto(on: boolean): void {
    if (this.auto === on) return;
    this.auto = on;
    const p = this.planned;
    if (this.playing && p && !p.held && !p.layer && !p.staffDrop && p.plan.start > this.engine.now + SCHEDULE_MARGIN + 1) {
      this.dropRequested = false;
      const up = this.unplan();
      if (up) this.schedule(up.track, up.buffer, up.requested, up.entry, { deferred: up.deferred, tempo: up.tempo });
    }
    if (on && this.note?.startsWith("AI DJ")) this.note = null;
    this.emit();
  }

  /**
   * Sync: set one deck's tempo so its BPM matches the other's — the song on
   * air to the cued song's tempo (after its mix), or the cued song to the song
   * on air's current tempo. Half / double tempo counts (a 64 BPM ballad syncs
   * to 128). False when they're more than 8% apart, or there's no other song.
   */
  syncDeck(index: number): boolean {
    const cur = this.current;
    const p = this.planned;
    const a = cur?.track.analysis;
    const b = p?.track.analysis;
    if (!this.playing || !cur || !p || !a || !b) return false;
    const liveRate = this.paused?.deck === cur.deck ? this.paused.rate : (cur.deck.timeline?.rateAt(this.engine.now) ?? 1);
    if (index === cur.deck.index) {
      const target = b.bpm * (p.tempo ?? 1);
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
   * A cue pad on the song on air: jump to track position `to` on its next beat
   * (the groove carries on in time) and re-time the cued mix. Paused, it moves
   * the paused spot. Refused while its mix is under way or about to start, and
   * while it's still in a dialogue.
   */
  jumpTo(index: number, to: number): boolean {
    if (this.looping) this.exitLoop(index);
    const cur = this.current;
    const a = cur?.track.analysis;
    if (!this.playing || !cur || !a || cur.deck.index !== index || this.recovering) return false;
    if (this.paused) return this.movePaused(to);
    const p = this.planned;
    const now = this.engine.now;
    if (p && !p.held && p.plan.start <= now + SCHEDULE_MARGIN + 1) return false;
    const tl = cur.deck.timeline;
    if (!tl || cur.deck.pendingJump() !== null) return false;
    const at = tl.timeAt(nextBoundary(a, tl.positionAt(now + 0.08), 1 / BEATS_PER_BAR));
    if (!cur.deck.jumpAt(at, Math.max(0, Math.min(a.duration - 1, to)))) return false;
    // The mix point moved with the song: plan the cued mix again from the new position.
    if (p && !p.held && !p.layer) {
      this.dropRequested = p.staffDrop;
      const up = this.unplan();
      if (up) this.schedule(up.track, up.buffer, up.requested, up.entry, { deferred: up.deferred, tempo: up.tempo });
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
      if (gen !== this.generation || !this.playing || this.paused || !p || p.held || p.layer) return;
      if (p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return;
      this.dropRequested = p.staffDrop;
      const up = this.unplan();
      if (up) this.schedule(up.track, up.buffer, up.requested, up.entry, { deferred: up.deferred, tempo: up.tempo });
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
    this.current = { deck, track: up.track, startedAt: at };
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

  /** ⏸ on the outgoing deck during a mix: it stops and the incoming song carries on alone. */
  private takeOver(p: Planned): boolean {
    const cur = this.current!;
    const now = this.engine.now;
    clearTimeout(p.timer);
    this.cancelTransitionFx(p);
    cur.deck.fadeOutAndStop(PAUSE_FADE);
    p.deck.easeToNeutral(PAUSE_FADE, 1);
    // A layer never glided back to the song's own tempo: do it now (a blend's glide is already scheduled).
    const tl = p.deck.timeline;
    if (tl && !tl.ramp && Math.abs(tl.rateAt(now) - 1) > 0.001 && p.track.analysis) {
      const bar = 240 / (p.track.analysis.bpm * tl.rateAt(now));
      p.deck.rampRate(now + PAUSE_FADE, now + PAUSE_FADE + TEMPO_HANDBACK_BARS * bar, 1);
    }
    p.plan = { ...p.plan, end: now + PAUSE_FADE };
    p.layer = undefined;
    p.timer = setTimeout(() => this.handover(), PAUSE_FADE * 1000 + 60);
    this.note = `${cur.track.title} stopped — ${p.track.title} carries on`;
    this.emit();
    return true;
  }

  /** ⏸ on the incoming deck during a mix: it stops, the outgoing song carries on, and it comes in again later. */
  private cancelMix(p: Planned): void {
    const cur = this.current!;
    clearTimeout(p.timer);
    this.cancelTransitionFx(p);
    p.deck.fadeOutAndStop(PAUSE_FADE);
    cur.deck.easeToNeutral(PAUSE_FADE, 1);
    this.planned = null;
    const buffer = p.deck.buffer;
    const gen = this.generation;
    this.note = `${p.track.title} paused — it comes in near the end of this song (▶ to bring it in sooner)`;
    this.emit();
    // Once it is silent, plan it again for near the end of the current song.
    setTimeout(() => {
      if (gen !== this.generation || !this.playing || this.planned || this.paused || !buffer) return;
      p.deck.stopNow();
      cur.deck.clearFilter();
      this.schedule(p.track, buffer, p.requested, p.entry, { deferred: true, tempo: p.tempo });
    }, PAUSE_FADE * 1000 + 60);
  }

  /** Take back a cued transition that hasn't started, keeping its decoded track for a re-plan. */
  private unplan(): {
    track: Track;
    buffer: AudioBuffer;
    requested: boolean;
    entry: EntryChoice;
    deferred?: boolean;
    tempo?: number;
  } | null {
    const p = this.planned;
    if (!p?.deck.buffer) return null;
    const buffer = p.deck.buffer;
    clearTimeout(p.timer);
    p.deck.stopNow();
    p.deck.resetControls(0);
    this.planned = null;
    this.cancelTransitionFx(p);
    // The planned mix hasn't started: drop its automation, keep the music at full level.
    this.current?.deck.resetControls(1);
    return { track: p.track, buffer, requested: p.requested, entry: p.entry, deferred: p.deferred, tempo: p.tempo };
  }

  /**
   * Staff chose a track. `next`: it replaces the cued track (if that mix hasn't
   * started; otherwise it plays right after). Else it joins the end of the
   * queue. The auto-DJ still picks the transition, syncs the tempo and times
   * the mix for the mood, and steers back into the mood afterwards.
   */
  request(track: Track, next: boolean): void {
    if (track.status !== "ready" || !track.analysis || track.id === this.current?.track.id) return;
    this.requests = this.requests.filter((t) => t.id !== track.id);
    const p = this.planned;
    if (next && p && p.track.id !== track.id && this.playing && (p.held || p.plan.start > this.engine.now + SCHEDULE_MARGIN)) {
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
    if (!this.playing || !this.current || this.planned || this.planning) return;
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
      if (this.paused || this.looping) this.hold(loaded.track, loaded.buffer, loaded.requested, entry);
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
    // AI DJ off: no automatic mix — it waits for Drop / ▶ Play now and only comes in by itself near the end.
    const manual = !this.auto && !staffDrop && !opts.soon;
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
          ? mixOutPoint(a, bars, earliest)
          : mixOutPoint(a, bars, earliest, mood, leadBars);
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
      else if (mood.holdForDrop || opts.deferred || manual) T = tl.timeAt(mixOutPoint(a, 8, earliest));
      // On the breakdown a blend's bass swap was aimed at.
      else T = tl.timeAt(mixOutPoint(a, bars, earliest, mood, leadBars) + leadBars * barSeconds(a));
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
    this.planned = { deck: inc, track, plan, timer, requested, staffDrop, entry, startAt, holding, fx, deferred: opts.deferred, tempo: opts.tempo, manual };
    this.emit();
  }

  /** While paused: load the next song on a free deck without scheduling anything (it's planned on ▶). */
  private hold(track: Track, buffer: AudioBuffer, requested: boolean, entry: EntryChoice): void {
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
   * Start a layer on the next 4-bar phrase; arm the safety swap before either song runs out. With
   * `together` (▶ Play now) the song starts from its own start point and they swap at its first drop.
   */
  private scheduleLayer(
    track: Track,
    buffer: AudioBuffer,
    requested: boolean,
    entry: EntryChoice,
    opts: { together?: boolean; tempo?: number } = {},
  ): void {
    const cur = this.current!;
    const a = cur.track.analysis!;
    const b = track.analysis!;
    const tl = cur.deck.timeline!;
    const now = this.engine.now;
    const earliest = tl.positionAt(now + SCHEDULE_MARGIN);
    const t = tl.timeAt(nextBoundary(a, earliest, DROP_BOUNDARY_BARS));
    const outBpm = a.bpm * tl.rateAt(t);
    const outBeat = 60 / outBpm;
    const rate = outBpm / (b.bpm * (syncRatio(outBpm, b.bpm, this.mood.halfTime) ?? 1));
    const startAt = opts.together
      ? entry.kind === "auto"
        ? defaultStart(track)
        : entry.kind === "dialogue"
          ? (resolveEntry(track, entry).dialogue?.start ?? resolveEntry(track, entry).land)
          : resolveEntry(track, entry).land
      : layerEntry(track, entry);

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])], this.deckTarget);
    if (!inc) return;
    inc.load(track, buffer, this.loudnessTarget());
    const plan = layerIn(cur.deck, inc, t, outBeat);
    inc.start(t, startAt, rate);

    // Safety: swap by itself well before the current song's outro or the layered song's end.
    const outroAt = tl.timeAt(mixOutPoint(a, 8, earliest));
    const layeredEnds = t + (b.duration - startAt) / rate - 32 * outBeat;
    // Playing together: they swap when the new song reaches its first drop after where it starts.
    const barB = barSeconds(b);
    const drop = opts.together && b.barLevels ? drops(b.barLevels, b.fullLevel).find((d) => b.firstBeat + d.start * barB > startAt + barB / 2) : undefined;
    const swapAt = drop ? t + (b.firstBeat + drop.start * barB - startAt) / rate : undefined;
    const safety = Math.min(outroAt, layeredEnds);
    const timer =
      swapAt !== undefined && swapAt <= safety
        ? setTimeout(() => this.finishLayer(swapAt), Math.max(0, (swapAt - SCHEDULE_MARGIN - 1 - this.engine.now) * 1000))
        : setTimeout(() => this.finishLayer(), Math.max(0, (safety - SCHEDULE_MARGIN - 1 - this.engine.now) * 1000));
    this.planned = {
      deck: inc,
      track,
      plan,
      timer,
      requested,
      staffDrop: false,
      entry,
      startAt,
      holding: false,
      fx: false,
      tempo: opts.tempo,
      layer: { rate, together: opts.together, swapAt: swapAt !== undefined && swapAt <= safety ? swapAt : undefined },
    };
    this.note = opts.together
      ? `${track.title} plays along — it mixes in at its drop, or press Drop`
      : `Layering ${track.title} — press Drop to swap`;
    this.emit();
  }

  /** End a layer: swap the basslines on the next 4-bar phrase (or `at`, the new song's drop) and let the old song fade. */
  private finishLayer(at?: number): boolean {
    const p = this.planned;
    const cur = this.current;
    if (!p?.layer || p.plan.drop !== undefined || !cur?.deck.timeline || !this.playing) return false;
    const a = cur.track.analysis!;
    const tl = cur.deck.timeline;
    const now = this.engine.now;
    // Not before the layer has actually started.
    const from = Math.max(now + SCHEDULE_MARGIN, p.plan.start + 0.1);
    const t = at !== undefined && at >= from ? at : tl.timeAt(nextBoundary(a, tl.positionAt(from), DROP_BOUNDARY_BARS));
    const outBeat = 60 / (a.bpm * tl.rateAt(t));
    clearTimeout(p.timer);
    p.plan = layerSwap(cur.deck, p.deck, p.plan.start, t, outBeat);
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
    if (prev) {
      prev.deck.resetControls(0);
      prev.deck.unload();
    }
    // Drops and filter sweeps leave the incoming filter at an inaudible extreme.
    p.deck.clearFilter();
    // The opener has dropped into the party: its note is done.
    if (this.openerEnd !== null) this.note = null;
    this.openerEnd = null;
    this.current = { deck: p.deck, track: p.track, startedAt: p.plan.start };
    this.remember(p.track);
    this.deps.onPlayed?.(p.track, p.plan.kind, p.requested, this.mood.id);
    if (this.jump) this.jump = false;
    // After a staff request outside the mood's tempo, steer the next pick back into the mood.
    if (p.requested && isMoodJump(this.currentBpm(), this.mood)) {
      this.jump = true;
      this.note = `Back to ${this.mood.name} after this request`;
    }
    if (this.moodTracksLeft > 0 && --this.moodTracksLeft === 0) this.note = null;
    // AI DJ was off and nobody mixed before the song ran out: the auto-DJ did, and stays on.
    if (p.manual && !this.auto) {
      this.auto = true;
      this.note = "AI DJ is back on — the song was ending and nobody mixed";
    }
    this.emit();
    void this.planNext();
  }

  private cancelPlanned(): void {
    const p = this.planned;
    if (!p) return;
    clearTimeout(p.timer);
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
      this.current = { deck, track: next.track, startedAt: when };
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
              position: this.paused?.deck === d ? this.paused.position : d.timeline.positionAt(now),
              rate: this.paused?.deck === d ? this.paused.rate : d.timeline.rateAt(now),
              fader: d.fader.gain.value,
              bassDb: d.low.gain.value,
            }
          : null,
      ),
      mix: p && !p.held ? { start: p.plan.start, end: p.plan.end, drop: p.plan.drop } : null,
      loop: this.looping ? { deck: this.looping.deck.index, start: this.looping.start, end: this.looping.end } : null,
      mixOutPosition: p && !p.held && liveTl ? liveTl.positionAt(p.plan.start) : null,
      dropLocked: this.current?.deck.pendingJump(this.engine.now) != null,
      layering: !!p?.layer && p.plan.drop === undefined && this.engine.now >= p.plan.start,
      activeFx: this.fxWindows
        .filter((w) => w.start <= this.engine.now && this.engine.now < w.end)
        .map(({ kind, auto }) => ({ kind, auto })),
    };
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
            layerable:
              !p.layer &&
              !!c &&
              this.currentBpm() !== null &&
              canLayer(c.track, p.track, this.currentBpm()!, this.mood.halfTime),
            tempo: p.tempo ?? null,
            together: p.layer?.together ? { swapAt: p.layer.swapAt ?? null } : null,
          }
        : null,
      queue: [...this.requests],
      standby: this.standby ? { track: this.standby.track, deck: this.standby.deck.index } : null,
      note: this.note,
      error: this.error,
      deckCount: this.engine.decks.length,
      keyLock: this.keyLockReady,
      paused: this.paused?.deck.index ?? null,
      holding: !!this.paused?.hold,
      loop: this.looping ? { deck: this.looping.deck.index, beats: this.looping.beats } : null,
      auto: this.auto,
    });
  }
}
