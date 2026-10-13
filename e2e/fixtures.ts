// Synthetic club tracks for the e2e tests: kick, hats, bassline and pads laid
// out as intro · breakdown · drop · breakdown · drop · outro, so the drop
// detection and every transition have something real to work on.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_DIR = join(__dirname, ".fixtures");
const SR = 22050;

function track(bpm: number, rootHz: number, gain: number): Buffer {
  const beat = 60 / bpm;
  const bar = beat * 4;
  // [bars, kick, bass, pad]
  const plan: [number, number, number, number][] = [
    [16, 1, 0, 0],
    [8, 0, 0, 1],
    [16, 1, 1, 1],
    [8, 0, 0, 1],
    [16, 1, 1, 0],
    [8, 1, 0, 0],
  ];
  const totalBars = plan.reduce((s, p) => s + p[0], 0);
  const n = Math.floor((0.25 + totalBars * bar + 1) * SR);
  const out = new Float32Array(n);
  let rnd = 7;
  const noise = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let b0 = 0;
  for (const [bars, kick, bass, pad] of plan) {
    for (let b = b0; b < b0 + bars; b++) {
      for (let k = 0; k < 4; k++) {
        const t0 = 0.25 + (b * 4 + k) * beat;
        const i0 = Math.floor(t0 * SR);
        if (kick) for (let i = 0; i < 0.18 * SR && i0 + i < n; i++) {
          const t = i / SR;
          out[i0 + i] += 0.7 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 35)) * t) * Math.exp(-t * 14);
        }
        const h0 = Math.floor((t0 + beat / 2) * SR);
        for (let i = 0; i < 0.03 * SR && h0 + i < n; i++) out[h0 + i] += 0.08 * noise() * Math.exp(-(i / SR) * 110);
        if (bass) for (let i = 0; i < (beat / 2) * SR && h0 + i < n; i++) {
          const t = i / SR;
          out[h0 + i] += 0.35 * Math.sin(2 * Math.PI * rootHz * t) * Math.min(1, t * 200) * Math.exp(-t * 4);
        }
      }
    }
    if (pad) {
      const s = Math.floor((0.25 + b0 * bar) * SR);
      const e = Math.floor((0.25 + (b0 + bars) * bar) * SR);
      for (let i = s; i < e && i < n; i++) {
        const t = i / SR;
        out[i] += 0.05 * (Math.sin(2 * Math.PI * rootHz * 4 * t) + Math.sin(2 * Math.PI * rootHz * 4.76 * t) + Math.sin(2 * Math.PI * rootHz * 6 * t));
      }
    }
    b0 += bars;
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 28000 * gain))), 44 + i * 2);
  return buf;
}

/** Four tracks at 126–129 BPM; B is mastered 6 dB quieter to exercise volume matching. */
export const FIXTURES: { name: string; bpm: number; rootHz: number; gain: number }[] = [
  { name: "Test Groove A 126.wav", bpm: 126, rootHz: 55, gain: 1 },
  { name: "Test Groove B 128.wav", bpm: 128, rootHz: 49, gain: 0.5 },
  { name: "Test Groove C 127.wav", bpm: 127, rootHz: 58.27, gain: 1 },
  { name: "Test Groove D 129.wav", bpm: 129, rootHz: 51.91, gain: 1 },
];

export function writeFixtures(): string[] {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  return FIXTURES.map((f) => {
    const path = join(FIXTURE_DIR, f.name);
    writeFileSync(path, track(f.bpm, f.rootHz, f.gain));
    return path;
  });
}
