// Choosing audio outputs: the club speakers (PA) for the mix, and a separate
// preview / cue output (headphones) for listening ahead. Chrome/Edge route an
// AudioContext to a device with setSinkId. Client-only.

export interface OutputDevice {
  /** "" is the system default output. */
  id: string;
  label: string;
}

/** The browser can send audio to a chosen output device. */
export function canChooseOutputs(): boolean {
  return (
    typeof AudioContext !== "undefined" &&
    typeof AudioContext.prototype.setSinkId === "function" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.enumerateDevices
  );
}

/** Output devices (without the "default" alias). Labels are empty until `unlockLabels`. */
export async function listOutputs(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
}

/**
 * Chrome only names devices once a page has had microphone access. Ask once,
 * stop the microphone straight away (nothing is recorded); the names stay
 * available for this site.
 */
export async function unlockLabels(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    return true;
  } catch {
    return false;
  }
}

/** Send a context's output to a device ("" = default). False (and default output) if that fails. */
export async function routeTo(ctx: AudioContext, deviceId: string): Promise<boolean> {
  if (!ctx.setSinkId) return deviceId === "";
  try {
    if ((typeof ctx.sinkId === "string" ? ctx.sinkId : "") !== deviceId) await ctx.setSinkId(deviceId);
    return true;
  } catch {
    try {
      await ctx.setSinkId("");
    } catch {
      /* stay where it was */
    }
    return false;
  }
}

/** A short two-note tone on a device, to check which speakers it is. */
export async function testTone(deviceId: string): Promise<boolean> {
  const ctx = new AudioContext();
  const ok = await routeTo(ctx, deviceId);
  await ctx.resume();
  const t = ctx.currentTime + 0.05;
  for (const [freq, at] of [
    [660, 0],
    [990, 0.25],
  ] as const) {
    const osc = new OscillatorNode(ctx, { frequency: freq });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t + at);
    env.gain.linearRampToValueAtTime(0.3, t + at + 0.02);
    env.gain.linearRampToValueAtTime(0, t + at + 0.22);
    osc.connect(env).connect(ctx.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.25);
  }
  setTimeout(() => void ctx.close(), 900);
  return ok;
}
