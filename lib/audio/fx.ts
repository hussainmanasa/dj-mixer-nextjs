// Master effects staff can fire from the booth: echo, filter, reverb and a
// noise riser. They sit after the decks (master → fx → limiter), so they never
// touch the per-deck automation the auto-DJ schedules for its transitions.
// Every effect is scheduled on the AudioContext clock from a beat time the
// caller computes on the live deck's grid. Client-only.

export type FxKind = "echo" | "filter" | "reverb" | "riser";

export const FX_KINDS: FxKind[] = ["echo", "filter", "reverb", "riser"];

/** Low-pass cut-off when the filter effect is idle (inaudible). */
const FILTER_OPEN_HZ = 20000;

export class MasterFx {
  readonly input: GainNode;
  private readonly ctx: AudioContext;
  private readonly filter: BiquadFilterNode;
  private readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoFeedback: GainNode;
  private readonly reverbSend: GainNode;
  private readonly riserGain: GainNode;
  private readonly riserFilter: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private riser: AudioBufferSourceNode | null = null;

  constructor(ctx: AudioContext, output: AudioNode) {
    this.ctx = ctx;
    this.input = new GainNode(ctx);
    this.filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: FILTER_OPEN_HZ, Q: 0.7 });
    this.input.connect(this.filter).connect(output);

    // Echo: dotted-eighth delay with feedback, fed from a send.
    this.echoSend = new GainNode(ctx, { gain: 0 });
    this.echoDelay = new DelayNode(ctx, { maxDelayTime: 4, delayTime: 0.35 });
    this.echoFeedback = new GainNode(ctx, { gain: 0.5 });
    this.filter.connect(this.echoSend).connect(this.echoDelay).connect(output);
    this.echoDelay.connect(this.echoFeedback).connect(this.echoDelay);

    // Reverb: a generated 2.5 s decaying-noise impulse (no samples to license).
    this.reverbSend = new GainNode(ctx, { gain: 0 });
    const reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, 2.5) });
    this.filter.connect(this.reverbSend).connect(reverb).connect(output);

    // Riser: band-passed white noise sweeping up.
    this.noise = whiteNoise(ctx, 2);
    this.riserFilter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 400, Q: 1.5 });
    this.riserGain = new GainNode(ctx, { gain: 0 });
    this.riserFilter.connect(this.riserGain).connect(output);
  }

  /**
   * Fire an effect starting at context time `t` (a beat on the live deck),
   * timed to `beatSec`. Returns the context time the effect has finished.
   * Firing again restarts it.
   */
  trigger(kind: FxKind, t: number, beatSec: number): number {
    switch (kind) {
      case "echo": {
        // Throw one beat into the echo; the feedback carries it for ~2 bars.
        hold(this.echoDelay.delayTime, t).setValueAtTime(Math.min(4, beatSec * 0.75), t);
        const g = hold(this.echoSend.gain, t);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.7, t + 0.02);
        g.setValueAtTime(0.7, t + beatSec);
        g.linearRampToValueAtTime(0, t + beatSec + 0.03);
        return t + 8 * beatSec;
      }
      case "filter": {
        // One-bar low-pass dip: down over 2 beats, back up over 2.
        const f = hold(this.filter.frequency, t);
        f.setValueAtTime(FILTER_OPEN_HZ, t);
        f.exponentialRampToValueAtTime(350, t + 2 * beatSec);
        f.exponentialRampToValueAtTime(FILTER_OPEN_HZ, t + 4 * beatSec);
        const q = hold(this.filter.Q, t);
        q.setValueAtTime(0.7, t);
        q.linearRampToValueAtTime(4, t + 2 * beatSec);
        q.linearRampToValueAtTime(0.7, t + 4 * beatSec);
        return t + 4 * beatSec;
      }
      case "reverb": {
        // Swell into the reverb over a beat, hold a bar, let the tail fade.
        const g = hold(this.reverbSend.gain, t);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.8, t + beatSec);
        g.setValueAtTime(0.8, t + 4 * beatSec);
        g.linearRampToValueAtTime(0, t + 8 * beatSec);
        return t + 12 * beatSec;
      }
      case "riser":
        // Four bars of noise sweeping up, cut on the downbeat it reaches.
        return this.riserBetween(t, t + 16 * beatSec);
    }
  }

  /** A noise riser from `t` that peaks and cuts exactly at `end` (e.g. on a Drop). */
  riserBetween(t: number, end: number): number {
    stopSource(this.riser, Math.max(this.ctx.currentTime, t));
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.noise, loop: true });
    src.connect(this.riserFilter);
    src.start(t);
    src.stop(end + 0.05);
    src.onended = () => {
      if (this.riser === src) this.riser = null;
      src.disconnect();
    };
    this.riser = src;
    const f = hold(this.riserFilter.frequency, t);
    f.setValueAtTime(400, t);
    f.exponentialRampToValueAtTime(9000, end);
    const g = hold(this.riserGain.gain, t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.14, end - 0.02);
    g.linearRampToValueAtTime(0, end + 0.01);
    return end;
  }

  /** Cancel a riser (its Drop was re-planned). */
  stopRiser(): void {
    const now = this.ctx.currentTime;
    stopSource(this.riser, now);
    this.riserGain.gain.cancelScheduledValues(now);
    this.riserGain.gain.setValueAtTime(0, now);
  }

  /** Silence every effect now (on Stop). */
  reset(): void {
    const now = this.ctx.currentTime;
    for (const p of [this.echoSend.gain, this.reverbSend.gain, this.riserGain.gain]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(0, now);
    }
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(FILTER_OPEN_HZ, now);
    this.filter.Q.cancelScheduledValues(now);
    this.filter.Q.setValueAtTime(0.7, now);
    stopSource(this.riser, now);
  }
}

function stopSource(src: AudioBufferSourceNode | null, when: number): void {
  try {
    src?.stop(when);
  } catch {
    /* already stopped */
  }
}

/** Drop automation scheduled from `t` on, keeping the param's value there. */
function hold(param: AudioParam, t: number): AudioParam {
  param.cancelAndHoldAtTime(t);
  return param;
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  return buf;
}
