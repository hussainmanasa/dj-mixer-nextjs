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
import type { Deck } from "@/lib/audio/deck";
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
import type { EntryChoice, Mood, MoodId, Track, TransitionKind } from "@/lib/types";
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
}

/** What one deck is doing right now, read every animation frame by the booth display. */
export interface DeckView {
  /** False while the deck is cued for a scheduled start. */
  started: boolean;
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
  layer?: { rate: number };
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
  private silentSince: number | null = null;

  /** Key-lock was requested for this engine (it may still be unavailable). */
  readonly keyLock: boolean;
  private keyLockReady = false;

  constructor(deckCount: number, mood: MoodId, deps: AutoDJDeps, keyLock = false) {
    this.engine = new AudioEngine(deckCount);
    this.keyLock = keyLock;
    this.moodKey = mood;
    this.deps = deps;
    this.engine.onOutputChange = (missing) => {
      this.note = missing ? "Club speakers output not found — playing on this computer's default output" : null;
      this.emit();
    };
    for (const deck of this.engine.decks) {
      deck.onUnexpectedEnd = (d) => {
        if (this.playing && this.current?.deck === d) void this.recover("track ended early");
      };
    }
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
    if (this.keyLock && !this.keyLockReady) {
      this.keyLockReady = await this.engine.setKeyLock(true);
      if (!this.keyLockReady) this.note = "Key lock isn't available in this browser — tempo changes shift pitch";
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
    const loadedBuffer = loadedFirst ? await this.decodeTrack(loadedFirst.track) : null;
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
    // one already running finishes as planned.
    if (this.planned && this.planned.plan.start > this.engine.now + SCHEDULE_MARGIN + 1) {
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
    // Two songs layered: Drop swaps them.
    if (this.planned?.layer) return this.finishLayer();
    // The live song is still in its dialogue: let it reach its drop first.
    if (this.current.deck.pendingJump() !== null) return false;
    const p = this.planned;
    if (p && p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return false;
    if (p?.staffDrop) return true;
    this.dropRequested = true;
    const up = this.unplan();
    if (up) this.schedule(up.track, up.buffer, up.requested, up.entry);
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
    if (!this.playing || !cur || this.recovering || this.planning || cur.deck.pendingJump() !== null) return false;
    const p = this.planned;
    if (p && (p.layer || p.plan.start <= this.engine.now + SCHEDULE_MARGIN)) return false;
    const target = track ?? p?.track;
    const curBpm = this.currentBpm();
    if (!target || curBpm === null || !canLayer(cur.track, target, curBpm, this.mood.halfTime)) return false;
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
    if (!this.playing || !p || p.plan.start <= this.engine.now + SCHEDULE_MARGIN) return false;
    this.dropRequested = p.staffDrop;
    const up = this.unplan();
    if (!up) return false;
    this.schedule(up.track, up.buffer, up.requested, choice);
    return true;
  }

  /** Take back a cued transition that hasn't started, keeping its decoded track for a re-plan. */
  private unplan(): { track: Track; buffer: AudioBuffer; requested: boolean; entry: EntryChoice } | null {
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
    return { track: p.track, buffer, requested: p.requested, entry: p.entry };
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
    if (next && p && p.track.id !== track.id && this.playing && p.plan.start > this.engine.now + SCHEDULE_MARGIN) {
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
      this.schedule(loaded.track, loaded.buffer, loaded.requested, entry);
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
  private schedule(track: Track, buffer: AudioBuffer, requested = false, entry: EntryChoice = { kind: "auto" }): void {
    const cur = this.current!;
    const a = cur.track.analysis!;
    const b = track.analysis!;
    const tl = cur.deck.timeline!;
    const now = this.engine.now;
    const mood = this.mood;
    const earliest = tl.positionAt(now + SCHEDULE_MARGIN);

    const curBpm = a.bpm * tl.rateAt(now);
    const staffDrop = this.dropRequested;
    this.dropRequested = false;
    const opener = this.openerEnd !== null;
    // Desi Night holds each song (after the opener) until Drop; it still leaves near the end on its own.
    const holding = !!mood.holdForDrop && !opener && !staffDrop;
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

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])]);
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
      let mixPos = mixOutPoint(a, bars, earliest, mood, leadBars);
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
      rate = synced ? outBpm / (b.bpm * (syncRatio(outBpm, b.bpm, mood.halfTime) ?? 1)) : 1;
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
      if (staffDrop) T = tl.timeAt(nextBoundary(a, earliest, resolved.dialogue ? 1 : DROP_BOUNDARY_BARS));
      else if (opener) T = tl.timeAt(Math.max(this.openerEnd!, earliest));
      // Desi Night: near the end of the song (the outro), unless Drop comes first.
      else if (mood.holdForDrop) T = tl.timeAt(mixOutPoint(a, 8, earliest));
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
        inc.start(plan.start, startAt, 1);
        if (staffDrop || opener) riser = this.riser(Math.max(now + SCHEDULE_MARGIN, T - 2 * outBar), T, !staffDrop);
      } else {
        const ratio = syncRatio(outBpm, b.bpm, mood.halfTime);
        synced = ratio !== null;
        rate = ratio ? outBpm / (b.bpm * ratio) : 1;
        const canBuild = synced && a.beatConfidence >= MIN_BLEND_CONFIDENCE && b.beatConfidence >= MIN_BLEND_CONFIDENCE;
        let land = T;
        let build = 0;
        if (canBuild) {
          // A staff Drop lands on a 4-bar boundary far enough ahead for a build-up.
          if (staffDrop) land = tl.timeAt(nextBoundary(a, tl.positionAt(now + SCHEDULE_MARGIN + MIN_DROP_BUILD_BARS * outBar), DROP_BOUNDARY_BARS));
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

    if (synced && Math.abs(rate - 1) > 0.001) {
      const handBack = TEMPO_HANDBACK_BARS * 4 * (60 / (a.bpm * tl.rateAt(plan.start)));
      inc.rampRate(plan.end, plan.end + handBack, 1);
    }
    // The outgoing deck is silent from plan.end; handover() stops and unloads it.

    const fx = mood.autoFx ? this.transitionFx(plan, beat, riser) : false;
    const timer = setTimeout(() => this.handover(), Math.max(0, (plan.end - this.engine.now) * 1000) + 60);
    this.planned = { deck: inc, track, plan, timer, requested, staffDrop, entry, startAt, holding, fx };
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

  /** Start a layer on the next 4-bar phrase; arm the safety swap before either song runs out. */
  private scheduleLayer(track: Track, buffer: AudioBuffer, requested: boolean, entry: EntryChoice): void {
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
    const startAt = layerEntry(track, entry);

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])]);
    if (!inc) return;
    inc.load(track, buffer, this.loudnessTarget());
    const plan = layerIn(cur.deck, inc, t, outBeat);
    inc.start(t, startAt, rate);

    // Safety: swap by itself well before the current song's outro or the layered song's end.
    const outroAt = tl.timeAt(mixOutPoint(a, 8, earliest));
    const layeredEnds = t + (b.duration - startAt) / rate - 32 * outBeat;
    const safety = Math.min(outroAt, layeredEnds);
    const timer = setTimeout(() => this.finishLayer(), Math.max(0, (safety - SCHEDULE_MARGIN - 1 - this.engine.now) * 1000));
    this.planned = { deck: inc, track, plan, timer, requested, staffDrop: false, entry, startAt, holding: false, fx: false, layer: { rate } };
    this.note = `Layering ${track.title} — press Drop to swap`;
    this.emit();
  }

  /** End a layer: swap the basslines on the next 4-bar phrase and let the old song fade. */
  private finishLayer(): boolean {
    const p = this.planned;
    const cur = this.current;
    if (!p?.layer || p.plan.drop !== undefined || !cur?.deck.timeline || !this.playing) return false;
    const a = cur.track.analysis!;
    const tl = cur.deck.timeline;
    const now = this.engine.now;
    // Not before the layer has actually started.
    const from = Math.max(now + SCHEDULE_MARGIN, p.plan.start + 0.1);
    const t = tl.timeAt(nextBoundary(a, tl.positionAt(from), DROP_BOUNDARY_BARS));
    const outBeat = 60 / (a.bpm * tl.rateAt(t));
    clearTimeout(p.timer);
    p.plan = layerSwap(cur.deck, p.deck, p.plan.start, t, outBeat);
    if (Math.abs(p.layer.rate - 1) > 0.001) {
      p.deck.rampRate(p.plan.end, p.plan.end + TEMPO_HANDBACK_BARS * 4 * outBeat, 1);
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
    if (this.engine.decks.length < 3 || this.standby || !this.playing) return;
    const gen = this.generation;
    const exclude = new Set([this.current?.track.id, this.planned?.track.id].filter((x): x is string => !!x));
    const loaded = await this.loadNextTrack(this.selectionContext(), exclude);
    if (!loaded || gen !== this.generation || !this.playing || this.standby) return;
    const used = [this.current?.deck, this.planned?.deck].filter((d): d is Deck => !!d);
    const deck = this.engine.freeDeck(used);
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
      if (!this.playing || this.recovering || !this.current) return;
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
              position: d.timeline.positionAt(now),
              rate: d.timeline.rateAt(now),
              fader: d.fader.gain.value,
              bassDb: d.low.gain.value,
            }
          : null,
      ),
      mix: p ? { start: p.plan.start, end: p.plan.end, drop: p.plan.drop } : null,
      mixOutPosition: p && liveTl ? liveTl.positionAt(p.plan.start) : null,
      dropLocked: this.current?.deck.pendingJump(this.engine.now) != null,
      layering: !!p?.layer && p.plan.drop === undefined && this.engine.now >= p.plan.start,
      activeFx: this.fxWindows
        .filter((w) => w.start <= this.engine.now && this.engine.now < w.end)
        .map(({ kind, auto }) => ({ kind, auto })),
    };
  }

  private emit(): void {
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
          }
        : null,
      queue: [...this.requests],
      standby: this.standby ? { track: this.standby.track, deck: this.standby.deck.index } : null,
      note: this.note,
      error: this.error,
      deckCount: this.engine.decks.length,
      keyLock: this.keyLockReady,
    });
  }
}
