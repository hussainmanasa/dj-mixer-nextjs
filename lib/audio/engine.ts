// The audio graph: N decks (2–4) → master bus → effects → limiter → speakers, with
// analysers on the master for level metering and silence detection.
// Client-only. Create it from a user gesture (browsers block audio otherwise).

import { MAX_DECKS, MIN_DECKS } from "@/lib/types";
import { Deck } from "./deck";
import { MasterFx } from "./fx";
import { createKeyLock, KEYLOCK_DELAY_SAMPLES, loadKeyLock } from "./keylock";
import { listOutputs, routeTo } from "./outputs";

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  /** Staff-fired effects on the whole mix (never on a single deck's automation). */
  readonly fx: MasterFx;
  readonly limiter: DynamicsCompressorNode;
  readonly analyser: AnalyserNode;
  /** Long window (~0.7 s) so the silence watchdog never falls between beats. */
  readonly watchAnalyser: AnalyserNode;
  readonly decks: Deck[];
  private readonly levelBuf: Float32Array<ArrayBuffer>;
  private readonly watchBuf: Float32Array<ArrayBuffer>;

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
    this.watchAnalyser = new AnalyserNode(this.ctx, { fftSize: 32768 });
    // Analysers pass audio through unchanged; chaining them keeps both processed.
    this.fx = new MasterFx(this.ctx, this.limiter);
    this.master.connect(this.fx.input);
    this.limiter.connect(this.analyser).connect(this.watchAnalyser).connect(this.ctx.destination);
    this.decks = Array.from({ length: n }, (_, i) => new Deck(this.ctx, this.master, i));
    this.levelBuf = new Float32Array(this.analyser.fftSize);
    this.watchBuf = new Float32Array(this.watchAnalyser.fftSize);
  }

  /**
   * Seconds between a deck playing a sample and it reaching the master (the
   * key-lock delay, 0 without key-lock). Beat times on the master — what the
   * room hears — are deck times + this.
   */
  outputDelay = 0;

  /** Turn key-lock on or off for every deck (only while stopped). Resolves to the state actually in effect. */
  async setKeyLock(on: boolean): Promise<boolean> {
    const ok = on && (await loadKeyLock(this.ctx));
    for (const d of this.decks) d.setKeyLock(ok ? createKeyLock(this.ctx) : null);
    this.outputDelay = ok ? KEYLOCK_DELAY_SAMPLES / this.ctx.sampleRate : 0;
    return ok;
  }

  /** The chosen output for the mix ("" = system default) and whether it is actually in use. */
  private output = { wanted: "", missing: false };
  /** Called when the chosen output disappears or comes back. */
  onOutputChange: ((missing: boolean) => void) | null = null;

  /**
   * Send the mix to an output device (the club speakers); can change mid-set.
   * If that device disappears (Bluetooth drops, cable pulled) the mix falls
   * back to the default output, and returns when the device does.
   */
  async setOutput(deviceId: string): Promise<boolean> {
    this.output.wanted = deviceId;
    navigator.mediaDevices?.addEventListener?.("devicechange", this.checkOutput);
    return this.checkOutput();
  }

  private checkOutput = async (): Promise<boolean> => {
    const { wanted } = this.output;
    const present = wanted === "" || (await listOutputs()).some((d) => d.id === wanted);
    const ok = present && (await routeTo(this.ctx, wanted));
    if (!ok) await routeTo(this.ctx, "");
    if (this.output.missing !== !ok) {
      this.output.missing = !ok;
      this.onOutputChange?.(!ok);
    }
    return ok;
  };

  /**
   * Seconds from scheduling a sound to the room hearing it: the key-lock delay
   * plus the output device's own latency (large on Bluetooth). The booth's
   * visuals use it so the jog wheels and beat pulse match what people hear.
   */
  get displayDelay(): number {
    return this.outputDelay + (this.ctx.outputLatency || 0);
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

  /**
   * Loudest master sample over the last ~0.7 s, 0..1. Used for silence
   * detection: a short RMS window can land in the gaps between sparse hits
   * every time it's sampled and report silence while the music plays.
   */
  peak(): number {
    this.watchAnalyser.getFloatTimeDomainData(this.watchBuf);
    let m = 0;
    for (let i = 0; i < this.watchBuf.length; i++) {
      const v = Math.abs(this.watchBuf[i]);
      if (v > m) m = v;
    }
    return m;
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
    this.fx.reset();
    this.master.gain.setValueAtTime(0.9, this.now);
  }

  async close(): Promise<void> {
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.checkOutput);
    for (const d of this.decks) d.unload();
    await this.ctx.close();
  }
}
