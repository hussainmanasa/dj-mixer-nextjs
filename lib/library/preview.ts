// Previews: play part of a track — with a click on every beat of a grid (to
// check it by ear), or from a marker, or a dialogue followed by a jump to the
// drop — and report the playhead for "Mark now" / "Set start here". Uses its
// own AudioContext, routed to the preview / cue output (headphones) when one
// is chosen, so it never touches the mix. One shared player (`sharedPreview`)
// serves the track editor, the booth's Cue and the picker. Client-only.

import { routeTo } from "@/lib/audio/outputs";

export interface Grid {
  bpm: number;
  firstBeat: number;
}

export interface PlayOptions {
  /** Seconds to play (default: to the end of the track). */
  length?: number;
  /** Jump from track position `at` to `to` (dialogue → drop), then play `after` seconds. */
  jump?: { at: number; to: number; after: number };
  /** Click on every beat of this grid (beat 1 higher). */
  clicks?: Grid;
}

export class GridPreview {
  /** Output device for every preview ("" = system default). Set from the settings. */
  static sinkId = "";

  private ctx: AudioContext | null = null;
  private cache: { file: Blob; buffer: AudioBuffer } | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private clock: { t0: number; from: number; jump?: { at: number; to: number } } | null = null;
  /** Called when playback ends on its own. */
  onEnded: (() => void) | null = null;

  /** Play `bars` bars from track position `from` with clicks on `grid` (beat 1 accented). */
  async play(file: Blob, grid: Grid, from: number, bars = 8): Promise<void> {
    await this.playFrom(file, from, { length: bars * 4 * (60 / grid.bpm), clicks: grid });
  }

  /** Play from a track position; see PlayOptions. */
  async playFrom(file: Blob, from: number, opts: PlayOptions = {}): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    await routeTo(this.ctx, GridPreview.sinkId);
    await this.ctx.resume();
    if (this.cache?.file !== file) this.cache = { file, buffer: await this.ctx.decodeAudioData(await file.arrayBuffer()) };
    const ctx = this.ctx;
    const buffer = this.cache.buffer;
    const t0 = ctx.currentTime + 0.1;
    const out = new GainNode(ctx, { gain: 0.8 });
    out.connect(ctx.destination);

    const segments: { when: number; offset: number; length: number }[] = [];
    if (opts.jump) {
      const first = Math.max(0, opts.jump.at - from);
      segments.push({ when: t0, offset: from, length: first });
      segments.push({ when: t0 + first, offset: opts.jump.to, length: Math.min(opts.jump.after, buffer.duration - opts.jump.to) });
    } else {
      segments.push({ when: t0, offset: from, length: Math.min(opts.length ?? Infinity, buffer.duration - from) });
    }
    segments.forEach((s, i) => {
      const src = new AudioBufferSourceNode(ctx, { buffer });
      src.connect(out);
      src.start(s.when, s.offset, s.length);
      if (i === segments.length - 1) {
        src.onended = () => {
          if (this.nodes.includes(src)) {
            this.stop();
            this.onEnded?.();
          }
        };
      }
      this.nodes.push(src);
    });
    this.clock = { t0, from, jump: opts.jump && { at: opts.jump.at, to: opts.jump.to } };

    if (opts.clicks) {
      const grid = opts.clicks;
      const beat = 60 / grid.bpm;
      const end = from + segments[0].length;
      for (let k = Math.ceil((from - grid.firstBeat) / beat - 1e-6); grid.firstBeat + k * beat < end; k++) {
        const at = t0 + grid.firstBeat + k * beat - from;
        const downbeat = ((k % 4) + 4) % 4 === 0;
        const osc = new OscillatorNode(ctx, { frequency: downbeat ? 1760 : 1320 });
        const env = new GainNode(ctx, { gain: 0 });
        env.gain.setValueAtTime(downbeat ? 0.5 : 0.3, at);
        env.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
        osc.connect(env).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.06);
        this.nodes.push(osc);
      }
    }
  }

  /** Current track position of the playhead, or null when stopped. */
  position(): number | null {
    if (!this.clock || !this.ctx) return null;
    const elapsed = Math.max(0, this.ctx.currentTime - this.clock.t0);
    const { from, jump } = this.clock;
    if (jump && from + elapsed >= jump.at) return jump.to + (from + elapsed - jump.at);
    return from + elapsed;
  }

  stop(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    this.nodes = [];
    this.clock = null;
  }

  async close(): Promise<void> {
    this.stop();
    this.cache = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}

/** The one preview player (editor, booth Cue, picker): only one preview plays at a time. */
export const sharedPreview = new GridPreview();
