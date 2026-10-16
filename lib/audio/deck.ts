// One playback deck: buffer source → trim (volume matching) → 3-band EQ →
// filter → fader → out [→ key-lock] → master, plus an echo send (delay with
// feedback) used by echo-out transitions that also feeds `out`. Key-lock sits
// after all of the deck's automation, so fades and EQ moves still land on the
// beat; every deck gets the same key-lock delay, so decks stay aligned.
// Client-only: requires Web Audio.

import { trimDb } from "@/lib/analysis/loudness";
import type { Track } from "@/lib/types";
import { PlaybackTimeline, rebaseTimeline, type Jump } from "./timeline";

/** Overlap (s) of the two sources at a jump, so the cut doesn't click. */
const JUMP_XFADE = 0.01;
/** Length (s) of a rewind / spinback. */
export const REWIND_SECONDS = 0.9;

export const EQ_KILL_DB = -26;

export class Deck {
  readonly index: number;
  private readonly ctx: AudioContext;
  /** Volume matching: brings every track to the same loudness (set on load). */
  readonly trim: GainNode;
  readonly low: BiquadFilterNode;
  readonly mid: BiquadFilterNode;
  readonly high: BiquadFilterNode;
  readonly filter: BiquadFilterNode;
  readonly fader: GainNode;
  readonly echoSend: GainNode;
  readonly echoDelay: DelayNode;
  readonly echoFeedback: GainNode;
  /** Taps the fader's output for the booth's channel level meter (display only). */
  private readonly meter: AnalyserNode;
  private meterData: Float32Array<ArrayBuffer> | null = null;
  /** Everything the deck outputs passes through here. */
  readonly out: GainNode;
  private readonly destination: AudioNode;
  private keyLock: AudioWorkletNode | null = null;
  /** out → [key-lock] → this gain → master. A second route fades in when key-lock is switched mid-set. */
  private route: GainNode;

  private source: AudioBufferSourceNode | null = null;
  /** The gain the current source plays through (faded across a hot-cue jump). */
  private sourceGain: GainNode | null = null;
  /** Before a scheduled jump: the source playing the part up to the jump (e.g. a dialogue). */
  private preJump: AudioBufferSourceNode | null = null;
  /** The gain `preJump` plays through (faded out across the jump). */
  private preGain: GainNode | null = null;
  /** A scheduled rewind (spinback). */
  private rewindSrc: AudioBufferSourceNode | null = null;
  track: Track | null = null;
  buffer: AudioBuffer | null = null;
  timeline: PlaybackTimeline | null = null;
  /** Called when playback ends without us stopping it (e.g. the file ran out). */
  onUnexpectedEnd: ((deck: Deck) => void) | null = null;
  private stopping = false;

  constructor(ctx: AudioContext, destination: AudioNode, index: number) {
    this.ctx = ctx;
    this.index = index;
    this.destination = destination;
    this.out = new GainNode(ctx, { gain: 1 });
    this.route = this.connectRoute(null, 1);
    this.trim = new GainNode(ctx, { gain: 1 });
    this.low = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 200, gain: 0 });
    this.mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1000, Q: 0.7, gain: 0 });
    this.high = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 3500, gain: 0 });
    // Neutral filter: an all-pass we retype to high/low-pass during sweeps.
    this.filter = new BiquadFilterNode(ctx, { type: "allpass", frequency: 1000 });
    this.fader = new GainNode(ctx, { gain: 0 });
    this.echoSend = new GainNode(ctx, { gain: 0 });
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 4, delayTime: 0.375 });
    this.echoFeedback = new GainNode(ctx, { gain: 0.45 });

    this.trim.connect(this.low);
    this.low.connect(this.mid).connect(this.high).connect(this.filter).connect(this.fader).connect(this.out);
    // Echo taps pre-fader so the tail keeps ringing after the fader closes.
    this.filter.connect(this.echoSend).connect(this.echoDelay).connect(this.out);
    this.echoDelay.connect(this.echoFeedback).connect(this.echoDelay);
    this.meter = new AnalyserNode(ctx, { fftSize: 1024 });
    this.fader.connect(this.meter);
  }

  /** The loudest sample after the fader over the last ~20 ms (0..1+), for the channel meter. */
  level(): number {
    this.meterData ??= new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(this.meterData);
    let peak = 0;
    for (const v of this.meterData) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  /**
   * Colour FX position for the booth's CFX knob (display only): −1 = low-pass closed, 0 = open, +1 = high-pass
   * fully up, from the filter's type and cut-off.
   */
  filterPosition(): number {
    const f = this.filter;
    if (f.type === "allpass") return 0;
    const hz = Math.max(20, Math.min(20000, f.frequency.value));
    const octaves = Math.log2(hz / 20) / Math.log2(1000);
    if (f.type === "lowpass") return -Math.max(0, Math.min(1, 1 - octaves));
    if (f.type === "highpass") return Math.max(0, Math.min(1, octaves));
    return 0;
  }

  private connectRoute(node: AudioWorkletNode | null, gain: number): GainNode {
    const g = new GainNode(this.ctx, { gain });
    if (node) this.out.connect(node).connect(g);
    else this.out.connect(g);
    g.connect(this.destination);
    return g;
  }

  /**
   * Route the deck through a key-lock node (or straight to the master with
   * null). With `fade` (mid-set) the new route crossfades in over that many
   * seconds; the key-lock route is KEYLOCK_DELAY later, so the switch smears
   * for a moment. The new node's pitch picks up the deck's current tempo and
   * any glide still under way.
   */
  setKeyLock(node: AudioWorkletNode | null, fade = 0): void {
    const old = { gain: this.route, node: this.keyLock };
    const now = this.ctx.currentTime;
    this.keyLock = node;
    this.route = this.connectRoute(node, fade > 0 ? 0 : 1);
    const tl = this.timeline;
    const pitch = this.pitch;
    if (pitch && tl) {
      pitch.setValueAtTime(1 / tl.rateAt(now), now);
      const r = tl.ramp;
      if (r && r.t1 > now) {
        const from = Math.max(now, r.t0);
        pitch.setValueAtTime(1 / tl.rateAt(from), from);
        pitch.linearRampToValueAtTime(1 / r.r1, r.t1);
      }
    }
    const disconnect = () => {
      this.out.disconnect(old.node ?? old.gain);
      old.node?.disconnect();
      old.gain.disconnect();
    };
    if (fade <= 0) return disconnect();
    this.route.gain.setValueAtTime(0, now);
    this.route.gain.linearRampToValueAtTime(1, now + fade);
    old.gain.gain.setValueAtTime(1, now);
    old.gain.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(disconnect, (fade + 0.2) * 1000);
  }

  /** Take the deck out of the graph for good (the engine removed it). */
  dispose(): void {
    this.unload();
    this.out.disconnect();
    this.keyLock?.disconnect();
    this.route.disconnect();
    this.echoDelay.disconnect();
  }

  /** Key-lock pitch follows 1 / playbackRate so the track keeps its key. */
  private get pitch(): AudioParam | null {
    return this.keyLock?.parameters.get("pitch") ?? null;
  }

  get isPlaying(): boolean {
    return this.source !== null;
  }

  /** Load a track, trimming it to `targetLoudness` (the library's typical level). */
  load(track: Track, buffer: AudioBuffer, targetLoudness?: number): void {
    this.stopNow();
    this.track = track;
    this.buffer = buffer;
    // The deck is silent between load and start, so the trim can change at once.
    this.trim.gain.setValueAtTime(Math.pow(10, trimDb(track.analysis?.loudness, targetLoudness) / 20), this.ctx.currentTime);
  }

  /**
   * Start playback at context time `when` from track position `offset`. With
   * a `jump`, playback continues from track position `jump.to` at context time
   * `jump.at` (a dialogue that cuts straight to the drop) — two sources with a
   * 10 ms crossfade, both scheduled on the audio clock.
   */
  start(when: number, offset: number, rate: number, jump?: Jump): void {
    if (!this.buffer) throw new Error(`Deck ${this.index}: nothing loaded`);
    this.stopNow();
    const at = Math.max(this.ctx.currentTime, when - 0.01);
    const pitch = this.pitch;
    if (pitch) {
      pitch.cancelScheduledValues(this.ctx.currentTime);
      pitch.setValueAtTime(1 / rate, at);
    }

    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer });
    src.playbackRate.setValueAtTime(rate, at);
    this.watchEnd(src);

    if (jump && jump.at > when) {
      // Up to the jump: the pre-jump part, faded out across the cut.
      const pre = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer });
      pre.playbackRate.setValueAtTime(rate, at);
      const preGain = new GainNode(this.ctx, { gain: 1 });
      preGain.gain.setValueAtTime(1, jump.at - JUMP_XFADE / 2);
      preGain.gain.linearRampToValueAtTime(0, jump.at + JUMP_XFADE / 2);
      pre.connect(preGain).connect(this.trim);
      pre.start(when, offset);
      pre.stop(jump.at + JUMP_XFADE);
      pre.onended = () => preGain.disconnect();
      this.preJump = pre;
      this.preGain = preGain;
      // From the jump: the rest of the track, faded in across the cut.
      const mainGain = new GainNode(this.ctx, { gain: 0 });
      mainGain.gain.setValueAtTime(0, jump.at - JUMP_XFADE / 2);
      mainGain.gain.linearRampToValueAtTime(1, jump.at + JUMP_XFADE / 2);
      src.connect(mainGain).connect(this.trim);
      src.start(jump.at - JUMP_XFADE / 2, Math.max(0, jump.to - (JUMP_XFADE / 2) * rate));
      this.timeline = new PlaybackTimeline(when, offset, rate, null, jump);
      this.sourceGain = mainGain;
    } else {
      const gain = new GainNode(this.ctx, { gain: 1 });
      src.connect(gain).connect(this.trim);
      src.start(when, offset);
      this.timeline = new PlaybackTimeline(when, offset, rate);
      this.sourceGain = gain;
    }
    this.source = src;
    this.stopping = false;
  }

  private watchEnd(src: AudioBufferSourceNode): void {
    src.onended = () => {
      if (this.source !== src) return;
      this.source = null;
      if (!this.stopping) this.onUnexpectedEnd?.(this);
    };
  }

  /**
   * Hot cue: while playing, jump to track position `to` at context time `at`
   * (on a beat), crossfading 10 ms on the audio clock. The tempo holds across
   * the jump; a glide still under way carries on after it. A jump still to come
   * (a dialogue) is called off first.
   */
  jumpAt(at: number, to: number): boolean {
    // A dialogue still playing: its jump is called off (the timeline holds one jump).
    if (this.pendingJump() !== null) this.cancelJump();
    const src = this.source;
    const gain = this.sourceGain;
    const tl = this.timeline;
    const buffer = this.buffer;
    const now = this.ctx.currentTime;
    // Not while a dialogue's jump is still to come (a timeline holds one jump).
    if (!src || !gain || !tl || !buffer || at <= now || (tl.jump && tl.jump.at > now)) return false;
    // A dialogue's jump that has happened left its first part stopped: nothing to keep.
    this.preJump = null;
    this.preGain = null;
    const glide = tl.ramp && tl.ramp.t1 > now ? tl.ramp : null;
    src.playbackRate.cancelAndHoldAtTime(now);
    this.pitch?.cancelAndHoldAtTime(now);
    const base = rebaseTimeline(tl, now);
    const rate = base.rate;
    gain.gain.setValueAtTime(1, at - JUMP_XFADE / 2);
    gain.gain.linearRampToValueAtTime(0, at + JUMP_XFADE / 2);
    src.stop(at + JUMP_XFADE);
    src.onended = () => gain.disconnect();
    const next = new AudioBufferSourceNode(this.ctx, { buffer });
    next.playbackRate.setValueAtTime(rate, now);
    const nextGain = new GainNode(this.ctx, { gain: 0 });
    nextGain.gain.setValueAtTime(0, at - JUMP_XFADE / 2);
    nextGain.gain.linearRampToValueAtTime(1, at + JUMP_XFADE / 2);
    next.connect(nextGain).connect(this.trim);
    next.start(at - JUMP_XFADE / 2, Math.max(0, to - (JUMP_XFADE / 2) * rate));
    this.watchEnd(next);
    this.source = next;
    this.sourceGain = nextGain;
    this.timeline = new PlaybackTimeline(now, base.startOffset, rate, null, { at, to });
    if (glide) this.rampRate(at, at + (glide.t1 - now), glide.r1);
    return true;
  }

  /**
   * Call off a jump still to come (a dialogue's cut to the drop): the song plays
   * straight on from where it is — staff looped it, jumped it or moved it. The
   * part before the jump becomes the playing source. False if none is pending.
   */
  cancelJump(): boolean {
    const tl = this.timeline;
    const pre = this.preJump;
    const preGain = this.preGain;
    const src = this.source;
    const now = this.ctx.currentTime;
    if (!tl?.jump || tl.jump.at <= now + 0.02 || !pre || !preGain || !src) return false;
    // The part from the jump hasn't started yet: it never will.
    src.onended = null;
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
    this.sourceGain?.disconnect();
    // Its fade and stop at the jump are taken back (the last stop() call wins).
    preGain.gain.cancelScheduledValues(now);
    preGain.gain.setValueAtTime(1, now);
    pre.stop(now + 86_400);
    pre.onended = null;
    const glide = tl.ramp && tl.ramp.t1 > now ? tl.ramp : null;
    if (glide) {
      pre.playbackRate.cancelAndHoldAtTime(now);
      this.pitch?.cancelAndHoldAtTime(now);
    }
    const next = new PlaybackTimeline(now, tl.positionAt(now), tl.rateAt(now));
    next.loop = tl.loop;
    this.source = pre;
    this.sourceGain = preGain;
    this.preJump = null;
    this.preGain = null;
    this.watchEnd(pre);
    this.timeline = next;
    if (glide) this.rampRate(now, glide.t1, glide.r1);
    return true;
  }

  /**
   * Beat loop: from now the source loops between track positions `start` and
   * `end` (the playhead must be at or after `start` and before `end`: it plays
   * on to `end`, then wraps). Calling it again resizes the loop. A tempo glide
   * under way stops at its current rate. A dialogue's jump still to come is called off.
   */
  setLoop(start: number, end: number): boolean {
    // A dialogue still playing: its jump is called off. A hot-cue jump still to come (`jumpAt` — e.g. to the
    // start of a loop the song is past) stays: the loop is set on the source that plays from it.
    if (this.pendingJump() !== null && this.preJump) this.cancelJump();
    const src = this.source;
    const tl = this.timeline;
    const now = this.ctx.currentTime;
    if (!src || !tl || end <= start || (tl.jump && tl.jump.at > now && this.preJump)) return false;
    this.preJump = null;
    this.preGain = null;
    if (tl.ramp && tl.ramp.t1 > now) {
      src.playbackRate.cancelAndHoldAtTime(now);
      this.pitch?.cancelAndHoldAtTime(now);
    }
    const next = rebaseTimeline(tl, now);
    next.loop = { start, end };
    src.loopStart = start;
    src.loopEnd = end;
    src.loop = true;
    this.timeline = next;
    return true;
  }

  /** Let the loop go: the song plays on from wherever the loop has it. */
  clearLoop(): void {
    const src = this.source;
    const tl = this.timeline;
    if (!src || !tl?.loop) return;
    const now = this.ctx.currentTime;
    const next = rebaseTimeline(tl, now);
    next.loop = null;
    src.loop = false;
    this.timeline = next;
  }

  /** Ramp playback rate linearly between two context times (for tempo hand-back). */
  rampRate(t0: number, t1: number, to: number): void {
    if (!this.source || !this.timeline) return;
    const from = this.timeline.rateAt(t0);
    for (const src of [this.source, this.preJump]) {
      src?.playbackRate.setValueAtTime(from, t0);
      src?.playbackRate.linearRampToValueAtTime(to, t1);
    }
    // 1/rate is close enough to linear over ±8% (< 3 cents off mid-ramp).
    this.pitch?.setValueAtTime(1 / from, t0);
    this.pitch?.linearRampToValueAtTime(1 / to, t1);
    this.timeline.ramp = { t0, t1, r0: from, r1: to };
  }

  /**
   * Staff moved the tempo slider: glide to `to` over `seconds` from now,
   * replacing any glide still scheduled (the timeline is rebased first, since
   * it holds only one ramp).
   */
  changeRate(to: number, seconds = 0.15): void {
    if (!this.source || !this.timeline) return;
    const now = this.ctx.currentTime;
    for (const src of [this.source, this.preJump]) src?.playbackRate.cancelAndHoldAtTime(now);
    this.pitch?.cancelAndHoldAtTime(now);
    this.timeline = rebaseTimeline(this.timeline, now);
    this.rampRate(now, now + seconds, to);
  }

  stopAt(when: number): void {
    if (!this.source) return;
    this.stopping = true;
    for (const src of [this.source, this.preJump]) {
      try {
        src?.stop(Math.max(when, this.ctx.currentTime));
      } catch {
        /* already stopped */
      }
    }
  }

  stopNow(): void {
    if (this.rewindSrc) {
      try {
        this.rewindSrc.stop();
      } catch {
        /* already stopped */
      }
      this.rewindSrc = null;
    }
    if (this.preJump) {
      try {
        this.preJump.stop();
      } catch {
        /* already stopped */
      }
      this.preJump.disconnect();
      this.preJump = null;
    }
    this.preGain?.disconnect();
    this.preGain = null;
    if (this.source) {
      this.stopping = true;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.sourceGain?.disconnect();
    this.sourceGain = null;
    this.timeline = null;
  }

  /**
   * Classic DJ rewind from context time `at`: the last few seconds play
   * backwards, speeding up 1× → 4× and fading out over REWIND_SECONDS. Web
   * Audio can't run a source backwards reliably, so it plays a reversed copy
   * of that stretch. It goes in after the fader (the caller cuts the fader at
   * `at`), so it's heard while the track itself stops.
   */
  rewind(at: number, seconds = REWIND_SECONDS, from?: number): void {
    const buf = this.buffer;
    // `from`: a track position to spin back from (a song already stopped, e.g. held on the jog wheel).
    const pos = from ?? this.timeline?.positionAt(at);
    if (!buf || pos === undefined) return;
    // 1× → 4× exponentially over `seconds` covers ~2.2 s of audio; take a little more.
    const span = Math.min(pos, 3);
    const n = Math.floor(span * buf.sampleRate);
    if (n < 64) return;
    const start = Math.max(0, Math.floor(pos * buf.sampleRate) - n);
    const rev = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c).subarray(start, start + n);
      const dst = rev.getChannelData(c);
      for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
    }
    const node = new AudioBufferSourceNode(this.ctx, { buffer: rev });
    node.playbackRate.setValueAtTime(1, at);
    node.playbackRate.exponentialRampToValueAtTime(4, at + seconds);
    const gain = new GainNode(this.ctx, { gain: 0 });
    gain.gain.setValueAtTime(0, at - 0.005);
    gain.gain.linearRampToValueAtTime(1, at + 0.01);
    gain.gain.setValueAtTime(1, at + seconds * 0.4);
    gain.gain.linearRampToValueAtTime(0, at + seconds);
    node.connect(gain).connect(this.out);
    node.start(at);
    node.stop(at + seconds + 0.02);
    node.onended = () => {
      gain.disconnect();
      if (this.rewindSrc === node) this.rewindSrc = null;
    };
    this.rewindSrc?.stop();
    this.rewindSrc = node;
  }

  /** Context time of a jump that hasn't happened yet (a dialogue still playing), else null. */
  pendingJump(now = this.ctx.currentTime): number | null {
    const j = this.timeline?.jump;
    return j && j.at > now ? j.at : null;
  }

  /** Track position at a context time (defaults to now). */
  position(at = this.ctx.currentTime): number {
    return this.timeline ? this.timeline.positionAt(at) : 0;
  }

  /** Cancel all automation and return every control to neutral, fader at `gain`. */
  resetControls(gain = 0): void {
    const now = this.ctx.currentTime;
    for (const param of [
      this.low.gain,
      this.mid.gain,
      this.high.gain,
      this.filter.frequency,
      this.fader.gain,
      this.echoSend.gain,
    ]) {
      param.cancelScheduledValues(now);
    }
    this.low.gain.setValueAtTime(0, now);
    this.mid.gain.setValueAtTime(0, now);
    this.high.gain.setValueAtTime(0, now);
    this.filter.type = "allpass";
    this.filter.frequency.setValueAtTime(1000, now);
    this.fader.gain.setValueAtTime(gain, now);
    this.echoSend.gain.setValueAtTime(0, now);
  }

  /**
   * Fade out over `seconds` from wherever the fader is (its automation is
   * dropped) and stop just after: a pause without a click. The echo send
   * closes too, so only an echo tail already ringing carries on.
   */
  fadeOutAndStop(seconds: number): void {
    const now = this.ctx.currentTime;
    for (const param of [this.fader.gain, this.echoSend.gain]) {
      param.cancelAndHoldAtTime(now);
      param.linearRampToValueAtTime(0, now + seconds);
    }
    this.stopAt(now + seconds + 0.01);
  }

  /**
   * Glide every control back to neutral over `seconds` (fader to `gain`),
   * from wherever its transition automation has got to. A high- or low-pass
   * filter glides to an inaudible cut-off, so `clearFilter()` is silent after.
   */
  easeToNeutral(seconds: number, gain = 1): void {
    const now = this.ctx.currentTime;
    const end = now + seconds;
    for (const [param, to] of [
      [this.low.gain, 0],
      [this.mid.gain, 0],
      [this.high.gain, 0],
      [this.fader.gain, gain],
      [this.echoSend.gain, 0],
    ] as const) {
      param.cancelAndHoldAtTime(now);
      param.linearRampToValueAtTime(to, end);
    }
    const f = this.filter.frequency;
    f.cancelAndHoldAtTime(now);
    if (this.filter.type === "highpass") f.exponentialRampToValueAtTime(10, end);
    else if (this.filter.type === "lowpass") f.exponentialRampToValueAtTime(20000, end);
  }

  /**
   * Back to the neutral all-pass filter after a transition. Only call when the
   * filter sits at an inaudible setting (high-pass ≈10 Hz, low-pass ≈20 kHz).
   */
  clearFilter(): void {
    this.filter.frequency.cancelScheduledValues(0);
    this.filter.type = "allpass";
    this.filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
  }

  /** Release the decoded buffer (big: ~10 MB per stereo minute). */
  unload(): void {
    this.stopNow();
    this.track = null;
    this.buffer = null;
  }
}
