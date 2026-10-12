// The audio graph: N decks (2–4) → master bus (limiter) → speakers, with an
// analyser on the master for level metering and silence detection.
// Client-only. Create it from a user gesture (browsers block audio otherwise).

import { MAX_DECKS, MIN_DECKS } from "@/lib/types";
import { Deck } from "./deck";

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  readonly decks: Deck[];
  private readonly levelBuf: Float32Array<ArrayBuffer>;

  constructor(deckCount: number) {
    const n = Math.max(MIN_DECKS, Math.min(MAX_DECKS, Math.round(deckCount)));
    this.ctx = new AudioContext({ latencyHint: "playback" });
    this.master = new GainNode(this.ctx, { gain: 0.9 });
    // Gentle safety limiter so overlapping decks never clip the PA.
    this.limiter = new DynamicsCompressorNode(this.ctx, {
      threshold: -3,
      knee: 2,
      ratio: 20,
      attack: 0.003,
      release: 0.15,
    });
    this.analyser = new AnalyserNode(this.ctx, { fftSize: 2048 });
    this.master.connect(this.limiter).connect(this.analyser).connect(this.ctx.destination);
    this.decks = Array.from({ length: n }, (_, i) => new Deck(this.ctx, this.master, i));
    this.levelBuf = new Float32Array(this.analyser.fftSize);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /**
   * Start the audio clock. Browsers only allow this after a user gesture
   * unless the kiosk runs Chrome with --autoplay-policy=no-user-gesture-required.
   */
  async resume(timeoutMs = 1500): Promise<void> {
    if (this.ctx.state === "running") return;
    await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, timeoutMs))]);
    if ((this.ctx.state as AudioContextState) !== "running") {
      throw new Error("The browser blocked audio. Press Play to start.");
    }
  }

  /** Decode a file at full quality for playback. */
  async decode(file: Blob): Promise<AudioBuffer> {
    const bytes = await file.arrayBuffer();
    return this.ctx.decodeAudioData(bytes);
  }

  /** A deck that is not playing, excluding the given ones. */
  freeDeck(exclude: Deck[] = []): Deck | null {
    return this.decks.find((d) => !d.isPlaying && !exclude.includes(d)) ?? null;
  }

  /** Master RMS level, 0..1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let s = 0;
    for (let i = 0; i < this.levelBuf.length; i++) s += this.levelBuf[i] * this.levelBuf[i];
    return Math.sqrt(s / this.levelBuf.length);
  }

  /** Fade the master out over `seconds`, then stop every deck. */
  async fadeOutAndStop(seconds = 2): Promise<void> {
    const t = this.now;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + seconds);
    await new Promise((r) => setTimeout(r, seconds * 1000 + 50));
    for (const d of this.decks) {
      d.stopNow();
      d.resetControls(0);
    }
    this.master.gain.setValueAtTime(0.9, this.now);
  }

  async close(): Promise<void> {
    for (const d of this.decks) d.unload();
    await this.ctx.close();
  }
}
