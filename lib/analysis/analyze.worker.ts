/// <reference lib="webworker" />
// Web Worker: runs the CPU-heavy beat/tempo analysis off the main thread so
// the booth UI and audio scheduling never stutter during library imports.

import { analyzeSamples, toMono } from "./bpm";

export interface AnalyzeRequest {
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  tagBpm: number | null;
}

export type AnalyzeResponse =
  | { id: string; ok: true; analysis: ReturnType<typeof analyzeSamples> }
  | { id: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { id, channels, sampleRate, tagBpm } = event.data;
  try {
    const analysis = analyzeSamples(toMono(channels), sampleRate, tagBpm);
    ctx.postMessage({ id, ok: true, analysis } satisfies AnalyzeResponse);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies AnalyzeResponse);
  }
};
