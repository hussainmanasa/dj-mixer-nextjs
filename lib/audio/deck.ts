// One playback deck: buffer source → trim (volume matching) → 3-band EQ →
// filter → fader → out [→ key-lock] → master, plus an echo send (delay with
// feedback) used by echo-out transitions that also feeds `out`. Key-lock sits
// after all of the deck's automation, so fades and EQ moves still land on the
// beat; every deck gets the same key-lock delay, so decks stay aligned.
// Client-only: requires Web Audio.

import { trimDb } from "@/lib/analysis/loudness";
import type { Track } from "@/lib/types";
import { PlaybackTimeline } from "./timeline";

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

  /** Start playback at context time `when` from track position `offset`. */
  start(when: number, offset: number, rate: number): void {
    if (!this.buffer) throw new Error(`Deck ${this.index}: nothing loaded`);
    this.stopNow();
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer });
    const at = Math.max(this.ctx.currentTime, when - 0.01);
    src.playbackRate.setValueAtTime(rate, at);
    const pitch = this.pitch;
    if (pitch) {
      pitch.cancelScheduledValues(this.ctx.currentTime);
      pitch.setValueAtTime(1 / rate, at);
    }
    src.connect(this.trim);
    src.onended = () => {
      if (this.source !== src) return;
      this.source = null;
      if (!this.stopping) this.onUnexpectedEnd?.(this);
    };
    src.start(when, offset);
    this.source = src;
    this.stopping = false;
    this.timeline = new PlaybackTimeline(when, offset, rate);
  }

  /** Ramp playback rate linearly between two context times (for tempo hand-back). */
  rampRate(t0: number, t1: number, to: number): void {
    if (!this.source || !this.timeline) return;
    const from = this.timeline.rateAt(t0);
    const p = this.source.playbackRate;
    p.setValueAtTime(from, t0);
    p.linearRampToValueAtTime(to, t1);
    // 1/rate is close enough to linear over ±8% (< 3 cents off mid-ramp).
    this.pitch?.setValueAtTime(1 / from, t0);
    this.pitch?.linearRampToValueAtTime(1 / to, t1);
    this.timeline.ramp = { t0, t1, r0: from, r1: to };
  }

  stopAt(when: number): void {
    if (!this.source) return;
    this.stopping = true;
    try {
      this.source.stop(Math.max(when, this.ctx.currentTime));
    } catch {
      /* already stopped */
    }
  }

  stopNow(): void {
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
