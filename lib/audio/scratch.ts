// Scratch: the jog wheel on a loaded or cued deck plays its song like a record
// under a hand — forwards, backwards, faster, slower, silent when the wheel
// stops — on the club speakers, through the mix's effects, limiter and master
// volume. Runs in the `scrub` worklet (public/worklets/scrub.js) on the engine's
// AudioContext; it never touches a deck or its automation. Client-only.

/** Seconds of the song handed to the worklet either side of where it's scratched. */
const WINDOW_SECONDS = 20;
/** Re-send the window when the wheel gets this close to its edge. */
const EDGE_SECONDS = 10;
/** A key / scroll step plays this long from the new position. */
const STEP_SECONDS = 0.25;
/** Scratch level into the master, a little under a deck at full fader. */
const LEVEL = 0.7;

export class Scratch {
  private node: Promise<AudioWorkletNode | null> | null = null;
  private window: { buffer: AudioBuffer; start: number; end: number } | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  /** The worklet node, or null if it can't load (then scratching is silent). */
  private load(): Promise<AudioWorkletNode | null> {
    this.node ??= this.ctx.audioWorklet
      .addModule("/worklets/scrub.js")
      .then(() => {
        const node = new AudioWorkletNode(this.ctx, "scrub", { numberOfInputs: 0, outputChannelCount: [2] });
        node.connect(new GainNode(this.ctx, { gain: LEVEL })).connect(this.out);
        return node;
      })
      .catch(() => null);
    return this.node;
  }

  /**
   * The wheel is at `position` (seconds) of `buffer`: playback chases it.
   * With `step`, play a short stretch forwards from there instead.
   */
  async move(buffer: AudioBuffer, position: number, step = false): Promise<void> {
    const node = await this.load();
    if (!node) return;
    const sr = buffer.sampleRate;
    const frame = Math.max(0, Math.min(buffer.length - 1, position * sr));
    const w = this.window;
    // Only the stretch around the wheel is copied to the worklet; move it along when the wheel nears
    // an edge (unless that edge is the song's own start or end).
    const nearEdge =
      w && ((frame < w.start + EDGE_SECONDS * sr && w.start > 0) || (frame > w.end - EDGE_SECONDS * sr && w.end < buffer.length));
    if (!w || w.buffer !== buffer || nearEdge || frame < w.start || frame > w.end) {
      const start = Math.max(0, Math.floor(frame - WINDOW_SECONDS * sr));
      const end = Math.min(buffer.length, Math.floor(frame + WINDOW_SECONDS * sr));
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(start, end));
      node.port.postMessage({ type: "window", channels, start }, channels.map((c) => c.buffer));
      this.window = { buffer, start, end };
    }
    node.port.postMessage(step ? { type: "play", frame, seconds: STEP_SECONDS } : { type: "target", frame });
  }

  /** Let go of the wheel: the scratch slows to a stop and goes silent. */
  end(): void {
    void this.node?.then((node) => node?.port.postMessage({ type: "end" }));
  }

  /** Forget the copied stretch (its song is no longer needed). */
  release(): void {
    this.end();
    this.window = null;
  }
}
