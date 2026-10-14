// Tests the scratch AudioWorklet's DSP (public/worklets/scrub.js) in Node.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SR = 48000;
const code = readFileSync(join(__dirname, "../../public/worklets/scrub.js"), "utf8");
type Proc = { message: (m: unknown) => void; process: (i: unknown, o: Float32Array[][]) => boolean; pos: number };
const ScrubProcessor = new Function(
  "AudioWorkletProcessor",
  "registerProcessor",
  "sampleRate",
  `${code}\nreturn ScrubProcessor;`,
)(class { port = { onmessage: null } }, () => {}, SR) as new () => Proc;

/** A track whose sample value is its own position (a ramp), so output reveals where it reads. */
function ramp(seconds: number): Float32Array {
  const x = new Float32Array(seconds * SR);
  for (let i = 0; i < x.length; i++) x[i] = i / x.length;
  return x;
}

function render(p: Proc, quanta: number): Float32Array {
  const all = new Float32Array(quanta * 128);
  for (let q = 0; q < quanta; q++) {
    const out = [[new Float32Array(128), new Float32Array(128)]];
    p.process([], out);
    all.set(out[0][0], q * 128);
  }
  return all;
}

describe("scratch worklet", () => {
  const track = ramp(10);
  const loaded = () => {
    const p = new ScrubProcessor();
    p.message({ type: "window", channels: [track], start: 0 });
    return p;
  };

  it("follows the wheel forwards and backwards", () => {
    const p = loaded();
    p.message({ type: "target", frame: 5 * SR });
    render(p, 10);
    p.message({ type: "target", frame: 5.2 * SR });
    render(p, 200);
    expect(p.pos / SR).toBeCloseTo(5.2, 2);
    p.message({ type: "target", frame: 4.9 * SR });
    const back = render(p, 60);
    // Reading the ramp backwards: the output falls.
    expect(back[back.length - 1000]).toBeLessThan(back[3000]);
  });

  it("goes silent when the wheel stops", () => {
    const p = loaded();
    p.message({ type: "target", frame: 5 * SR });
    p.message({ type: "target", frame: 5.3 * SR });
    const moving = render(p, 40);
    expect(Math.max(...moving.slice(2000).map(Math.abs))).toBeGreaterThan(0.1);
    const still = render(p, 400);
    expect(Math.max(...still.slice(-1000).map(Math.abs))).toBeLessThan(1e-3);
  });

  it("a key step plays a short stretch forwards at normal speed", () => {
    const p = loaded();
    p.message({ type: "play", frame: 2 * SR, seconds: 0.25 });
    render(p, Math.ceil((0.25 * SR) / 128));
    expect(p.pos / SR).toBeGreaterThan(2.2);
    expect(p.pos / SR).toBeLessThan(2.3);
  });

  it("never runs away past the wheel (speed is capped)", () => {
    const p = loaded();
    p.message({ type: "target", frame: 1 * SR });
    p.message({ type: "target", frame: 9 * SR });
    render(p, Math.ceil((0.5 * SR) / 128));
    // At most 6× speed: no more than 3 s of track in half a second.
    expect(p.pos / SR).toBeLessThan(4.1);
  });
});
