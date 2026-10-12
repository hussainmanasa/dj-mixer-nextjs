// The auto-DJ: picks every track, schedules every transition and recovers from
// failures with no human input. Staff only pick a mood and press play/stop.
// Client-only (owns the AudioEngine).
//
// Timing model: all audio events are scheduled ahead on the AudioContext
// clock (sample-accurate). JS timers are only used to *plan* the next step
// and to hand over between decks after a transition has finished, so timer
// jitter never reaches the audio.

import { AudioEngine } from "@/lib/audio/engine";
import type { Deck } from "@/lib/audio/deck";
import { blend, cut, echoOut, filterSweep, type TransitionPlan } from "@/lib/audio/transitions";
import type { Mood, MoodId, Track, TransitionKind } from "@/lib/types";
import { getMood, targetEnergy } from "./moods";
import { cueIn, mixOutPoint, nextDownbeat } from "./mixpoints";
import { chooseTransition, isMoodJump, pickNext, type SelectionContext } from "./selector";

/** Seconds of lead time we need to schedule a transition safely. */
const SCHEDULE_MARGIN = 2;
/** Bars over which an incoming deck's tempo glides back to its native rate. */
const TEMPO_HANDBACK_BARS = 16;
/** Master level below this for SILENCE_SECONDS triggers recovery. */
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
}

export interface AutoDJStatus {
  playing: boolean;
  mood: MoodId;
  now: NowPlaying | null;
  next: UpNext | null;
  note: string | null;
  error: string | null;
  deckCount: number;
}

export interface AutoDJDeps {
  getTracks: () => Track[];
  getFile: (track: Track) => Promise<File>;
  onTrackError: (trackId: string, message: string) => void;
  onStatus: (status: AutoDJStatus) => void;
}

interface Planned {
  deck: Deck;
  track: Track;
  plan: TransitionPlan;
  timer: ReturnType<typeof setTimeout>;
}

export class AutoDJ {
  readonly engine: AudioEngine;
  private readonly deps: AutoDJDeps;
  private mood: Mood;
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
  private planning = false;
  private recovering = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private silentSince: number | null = null;

  constructor(deckCount: number, mood: MoodId, deps: AutoDJDeps) {
    this.engine = new AudioEngine(deckCount);
    this.mood = getMood(mood);
    this.deps = deps;
    for (const deck of this.engine.decks) {
      deck.onUnexpectedEnd = (d) => {
        if (this.playing && this.current?.deck === d) void this.recover("track ended early");
      };
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get moodId(): MoodId {
    return this.mood.id;
  }

  // ── Public controls ────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.playing) return;
    await this.engine.resume();
    this.playing = true;
    this.error = null;
    this.generation++;
    const gen = this.generation;
    const first = await this.loadNextTrack(this.selectionContext(), new Set());
    if (!first || gen !== this.generation) {
      this.playing = false;
      this.error = first ? null : "No analysed tracks fit. Add music in the Library page.";
      this.emit();
      return;
    }
    const deck = this.engine.decks[0];
    deck.load(first.track, first.buffer);
    deck.resetControls(1);
    const when = this.engine.now + 0.1;
    deck.start(when, 0, 1);
    this.current = { deck, track: first.track, startedAt: when };
    this.remember(first.track);
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
    await this.engine.fadeOutAndStop(2);
    for (const d of this.engine.decks) d.unload();
    this.current = null;
    this.standby = null;
    this.note = null;
    this.emit();
  }

  /** Staff changed the mood. The music never cuts; the engine steers toward it. */
  setMood(id: MoodId): void {
    if (id === this.mood.id) return;
    this.mood = getMood(id);
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

  /** Pick + decode the next track, skipping files that fail to decode. */
  private async loadNextTrack(ctx: SelectionContext, exclude: Set<string>): Promise<{ track: Track; buffer: AudioBuffer } | null> {
    const skip = new Set([...exclude, ...this.failed]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const track = pickNext(this.deps.getTracks(), ctx, skip);
      if (!track) return null;
      try {
        const file = await this.deps.getFile(track);
        const buffer = await this.engine.decode(file);
        return { track, buffer };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not decode file";
        this.failed.add(track.id);
        skip.add(track.id);
        this.deps.onTrackError(track.id, message);
      }
    }
    return null;
  }

  private async planNext(): Promise<void> {
    if (!this.playing || !this.current || this.planned || this.planning) return;
    this.planning = true;
    const gen = this.generation;
    try {
      const exclude = new Set<string>(this.standby ? [this.standby.track.id] : []);
      const loaded = await this.loadNextTrack(this.selectionContext(), exclude);
      if (gen !== this.generation || !this.playing || !this.current || this.planned) return;
      if (!loaded) {
        this.note = "Not enough playable tracks — add more music";
        this.emit();
        return;
      }
      this.schedule(loaded.track, loaded.buffer);
      void this.prepareStandby();
    } finally {
      this.planning = false;
    }
  }

  private schedule(track: Track, buffer: AudioBuffer): void {
    const cur = this.current!;
    const a = cur.track.analysis!;
    const b = track.analysis!;
    const tl = cur.deck.timeline!;
    const now = this.engine.now;

    const curBpm = a.bpm * tl.rateAt(now);
    const kind = chooseTransition(cur.track, track, curBpm, this.jump);
    const bars = kind === "blend" ? this.mood.blendBars : 8;

    let mixPos = mixOutPoint(a, bars, tl.positionAt(now + SCHEDULE_MARGIN));
    let t = tl.timeAt(mixPos);
    if (t < now + 1) {
      mixPos = nextDownbeat(a, tl.positionAt(now + SCHEDULE_MARGIN));
      t = tl.timeAt(mixPos);
    }

    const inc = this.engine.freeDeck([cur.deck, ...(this.standby ? [this.standby.deck] : [])]);
    if (!inc) return;
    inc.load(track, buffer);

    const outBpmAtT = a.bpm * tl.rateAt(t);
    const outBeat = 60 / outBpmAtT;
    const synced = kind === "blend" || kind === "filterSweep";
    const rate = synced ? outBpmAtT / b.bpm : 1;

    let plan: TransitionPlan;
    switch (kind) {
      case "blend":
        plan = blend(cur.deck, inc, t, bars, outBeat);
        break;
      case "filterSweep":
        plan = filterSweep(cur.deck, inc, t, outBeat);
        break;
      case "echoOut":
        plan = echoOut(cur.deck, inc, t, outBeat);
        break;
      default:
        plan = cut(cur.deck, inc, t);
    }

    inc.start(plan.start, cueIn(b), rate);
    if (synced && Math.abs(rate - 1) > 0.001) {
      const handBack = TEMPO_HANDBACK_BARS * 4 * (60 / outBpmAtT);
      inc.rampRate(plan.end, plan.end + handBack, 1);
    }
    // The outgoing deck is silent from plan.end; handover() stops and unloads it.

    const timer = setTimeout(() => this.handover(), Math.max(0, (plan.end - this.engine.now) * 1000) + 60);
    this.planned = { deck: inc, track, plan, timer };
    this.emit();
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
    this.current = { deck: p.deck, track: p.track, startedAt: p.plan.start };
    this.remember(p.track);
    if (this.jump) this.jump = false;
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
    deck.load(loaded.track, loaded.buffer);
    this.standby = { deck, track: loaded.track };
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
      if (this.engine.level() < SILENCE_LEVEL) {
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
        this.planned = null;
      }
      let next: { track: Track; buffer: AudioBuffer } | null = null;
      let deck: Deck | null = null;
      if (this.standby?.deck.buffer) {
        next = { track: this.standby.track, buffer: this.standby.deck.buffer };
        deck = this.standby.deck;
        this.standby = null;
      } else {
        const exclude = new Set(this.current ? [this.current.track.id] : []);
        next = await this.loadNextTrack(this.selectionContext(), exclude);
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
      if (!deck.buffer) deck.load(next.track, next.buffer);
      deck.resetControls(1);
      const when = this.engine.now + 0.05;
      deck.start(when, cueIn(next.track.analysis!), 1);
      this.current = { deck, track: next.track, startedAt: when };
      this.remember(next.track);
      this.silentSince = null;
      this.note = `Recovered automatically (${reason})`;
      this.emit();
      void this.planNext();
    } finally {
      this.recovering = false;
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

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
      next: p ? { track: p.track, deck: p.deck.index, transition: p.plan.kind, at: p.plan.start } : null,
      note: this.note,
      error: this.error,
      deckCount: this.engine.decks.length,
    });
  }
}
