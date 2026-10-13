// Key-lock: keeps each track at its original key while the auto-DJ changes its
// tempo with playbackRate. The DSP is an AudioWorklet (public/worklets/keylock.js);
// this module loads it and creates the per-deck nodes. Client-only.

/** Input → output delay of the worklet, in samples, at any pitch (see keylock.test.ts). */
export const KEYLOCK_DELAY_SAMPLES = 2048;

const MODULE_URL = "/worklets/keylock.js";
const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Load the worklet module once per context. Resolves false if the browser can't. */
export function loadKeyLock(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet
      .addModule(MODULE_URL)
      .then(() => true)
      .catch(() => false);
    loaded.set(ctx, p);
  }
  return p;
}

/** A stereo key-lock node; set its `pitch` param to 1 / playbackRate. */
export function createKeyLock(ctx: BaseAudioContext): AudioWorkletNode {
  return new AudioWorkletNode(ctx, "keylock", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
}
