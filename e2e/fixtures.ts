// Synthetic club tracks for the e2e tests: kick, hats, bassline and pads laid
// out as intro · breakdown · drop · breakdown · drop · outro, so the drop
// detection and every transition have something real to work on.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_DIR = join(__dirname, ".fixtures");
/** Extra songs for the Desi Night phase 5–6 tests (loaded only by those tests). */
export const DESI_FIXTURE_DIR = join(__dirname, ".fixtures-desi");
const SR = 22050;

function wav(out: Float32Array, gain = 1): Buffer {
  const n = out.length;
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
  return wav(out, gain);
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

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * A ballad for the Desi Night tests: a speech-like "dialogue" (0.5–5.5 s, no
 * beat), then from 6 s kick + chords as verse · chorus · verse · chorus ·
 * verse · chorus, 8 bars each (the chorus repeats; verses differ).
 */
function ballad(bpm: number): Buffer {
  const beat = 60 / bpm;
  const bar = beat * 4;
  const start = 6;
  const n = Math.floor((start + 48 * bar + 1) * SR);
  const out = new Float32Array(n);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Dialogue: voiced syllables of irregular length and spacing.
  for (let t = 0.5; t < 5.5; ) {
    const len = 0.08 + rnd() * 0.18;
    const f0 = 180 + rnd() * 60;
    const i0 = Math.floor(t * SR);
    const m = Math.floor(len * SR);
    for (let i = 0; i < m; i++) {
      let v = 0;
      for (let h = 1; h <= 14; h++) v += (Math.sin((2 * Math.PI * f0 * h * i) / SR) * (h < 5 ? 1 : 0.4)) / h;
      out[i0 + i] += 0.3 * Math.sin((Math.PI * i) / m) * v;
    }
    t += len + 0.04 + rnd() * 0.22;
  }
  const chorus = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [57, 60, 64]];
  const verse = (s: number) => [[62 + s, 65 + s, 69 + s], [64 + s, 67 + s, 71 + s], [59 + s, 62 + s, 66 + s], [61 + s, 65 + s, 68 + s]];
  const plan = [verse(0), chorus, verse(1), chorus, verse(3), chorus];
  plan.forEach((prog, sec) => {
    for (let b = 0; b < 8; b++) {
      const t0 = start + (sec * 8 + b) * bar;
      const notes = prog[b % 4];
      const amp = prog === chorus ? 0.22 : 0.14;
      const i0 = Math.floor(t0 * SR);
      for (let i = 0; i < bar * SR && i0 + i < n; i++) {
        let v = 0;
        for (const m of notes) for (let h = 1; h <= 3; h++) v += Math.sin((2 * Math.PI * hz(m) * h * i) / SR) / h;
        out[i0 + i] += (amp * v) / notes.length;
      }
      for (let k = 0; k < 4; k++) {
        const k0 = Math.floor((t0 + k * beat) * SR);
        for (let i = 0; i < 0.18 * SR && k0 + i < n; i++) {
          const s = i / SR;
          out[k0 + i] += 0.6 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-s * 35)) * s) * Math.exp(-s * 14);
        }
      }
    }
  });
  return wav(out);
}

export function writeDesiFixtures(): string[] {
  mkdirSync(DESI_FIXTURE_DIR, { recursive: true });
  const files: [string, Buffer][] = [
    ["Test Ballad 92.wav", ballad(92)],
    // Kicks at 64 BPM: detected as 128 (folded); the test corrects it to 64 in the editor.
    ["Test Slow 64.wav", track(64, 55, 1)],
  ];
  return files.map(([name, buf]) => {
    const path = join(DESI_FIXTURE_DIR, name);
    writeFileSync(path, buf);
    return path;
  });
}
