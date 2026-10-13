// Admin preview: play a stretch of a track with a click on every beat of a
// beat grid, so a wrong BPM or first beat can be heard and fixed. Uses its
// own AudioContext; the Library page only allows it while the booth is
// stopped (it plays through the same speakers). Client-only.

export interface Grid {
  bpm: number;
  firstBeat: number;
}

export class GridPreview {
  private ctx: AudioContext | null = null;
  private cache: { file: Blob; buffer: AudioBuffer } | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  /** Called when playback ends on its own. */
  onEnded: (() => void) | null = null;

  /** Play `bars` bars from track position `from` with clicks on `grid` (beat 1 accented). */
  async play(file: Blob, grid: Grid, from: number, bars = 8): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    if (this.cache?.file !== file) this.cache = { file, buffer: await this.ctx.decodeAudioData(await file.arrayBuffer()) };
    const ctx = this.ctx;
    const buffer = this.cache.buffer;
    const beat = 60 / grid.bpm;
    const length = Math.min(bars * 4 * beat, buffer.duration - from);
    const t0 = ctx.currentTime + 0.1;

    const music = new AudioBufferSourceNode(ctx, { buffer });
    music.connect(new GainNode(ctx, { gain: 0.8 })).connect(ctx.destination);
    music.start(t0, from, length);
    music.onended = () => {
      if (this.nodes[0] === music) {
        this.nodes = [];
        this.onEnded?.();
      }
    };
    this.nodes.push(music);

    const first = Math.ceil((from - grid.firstBeat) / beat - 1e-6);
    for (let k = first; grid.firstBeat + k * beat < from + length; k++) {
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

  stop(): void {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    this.nodes = [];
  }

  async close(): Promise<void> {
    this.stop();
    this.cache = null;
    await this.ctx?.close();
    this.ctx = null;
  }
}
