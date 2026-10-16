/// <reference lib="webworker" />
// Web Worker: runs the CPU-heavy work off the main thread so the booth UI and
// audio scheduling never stutter — beat/tempo analysis during library imports,
// and the detailed waveforms of the songs on the decks (one worker for both:
// the bundler would hand a second worker the same entry).

import { analyzeSamples, toMono, type ForcedGrid } from "./bpm";
import { computeWaveform, type Waveform } from "./waveform";

export interface AnalyzeRequest {
  kind?: "analyze";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  tagBpm: number | null;
  forced: ForcedGrid | null;
}

export interface WaveformRequest {
  kind: "waveform";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
}

export type AnalyzeResponse =
  | { id: string; ok: true; analysis: ReturnType<typeof analyzeSamples> }
  | { id: string; ok: true; wave: Waveform }
  | { id: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<AnalyzeRequest | WaveformRequest>) => {
  const req = event.data;
  try {
    if (req.kind === "waveform") {
      const wave = computeWaveform(req.channels, req.sampleRate);
      ctx.postMessage({ id: req.id, ok: true, wave } satisfies AnalyzeResponse, [wave.peak.buffer, wave.low.buffer]);
    } else {
      const analysis = analyzeSamples(toMono(req.channels), req.sampleRate, req.tagBpm, req.forced);
      ctx.postMessage({ id: req.id, ok: true, analysis } satisfies AnalyzeResponse);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies AnalyzeResponse);
  }
};
