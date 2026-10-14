// One playback deck: buffer source → trim (volume matching) → 3-band EQ →
// filter → fader → out [→ key-lock] → master, plus an echo send (delay with
// feedback) used by echo-out transitions that also feeds `out`. Key-lock sits
// after all of the deck's automation, so fades and EQ moves still land on the
// beat; every deck gets the same key-lock delay, so decks stay aligned.
// Client-only: requires Web Audio.

import { trimDb } from "@/lib/analysis/loudness";
import type { Track } from "@/lib/types";
import { PlaybackTimeline, type Jump } from "./timeline";

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
  /** Everything the deck outputs passes through here. */
  readonly out: GainNode;
  private readonly destination: AudioNode;
  private keyLock: AudioWorkletNode | null = null;

  private source: AudioBufferSourceNode | null = null;
  /** Before a scheduled jump: the source playing the part up to the jump (e.g. a dialogue). */
  private preJump: AudioBufferSourceNode | null = null;
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
    this.out.connect(destination);
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
  }

  /** Route the deck through a key-lock node (or straight to the master with null). Only while stopped. */
  setKeyLock(node: AudioWorkletNode | null): void {
    this.out.disconnect();
    this.keyLock?.disconnect();
    this.keyLock = node;
    if (node) this.out.connect(node).connect(this.destination);
    else this.out.connect(this.destination);
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
    src.onended = () => {
      if (this.source !== src) return;
      this.source = null;
      if (!this.stopping) this.onUnexpectedEnd?.(this);
    };

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
      // From the jump: the rest of the track, faded in across the cut.
      const mainGain = new GainNode(this.ctx, { gain: 0 });
      mainGain.gain.setValueAtTime(0, jump.at - JUMP_XFADE / 2);
      mainGain.gain.linearRampToValueAtTime(1, jump.at + JUMP_XFADE / 2);
      src.connect(mainGain).connect(this.trim);
      src.start(jump.at - JUMP_XFADE / 2, Math.max(0, jump.to - (JUMP_XFADE / 2) * rate));
      this.timeline = new PlaybackTimeline(when, offset, rate, null, jump);
    } else {
      src.connect(this.trim);
      src.start(when, offset);
      this.timeline = new PlaybackTimeline(when, offset, rate);
    }
    this.source = src;
    this.stopping = false;
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
    this.timeline = null;
  }

  /**
   * Classic DJ rewind from context time `at`: the last few seconds play
   * backwards, speeding up 1× → 4× and fading out over REWIND_SECONDS. Web
   * Audio can't run a source backwards reliably, so it plays a reversed copy
   * of that stretch. It goes in after the fader (the caller cuts the fader at
   * `at`), so it's heard while the track itself stops.
   */
  rewind(at: number, seconds = REWIND_SECONDS): void {
    const buf = this.buffer;
    if (!buf || !this.timeline) return;
    const pos = this.timeline.positionAt(at);
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
