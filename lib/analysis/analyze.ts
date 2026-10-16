// Main-thread side of track analysis: decode the file at a low sample rate
// (small memory footprint) and hand the PCM to the analysis worker.
// Client-only.

import type { TrackAnalysis } from "@/lib/types";
import { ANALYSIS_SAMPLE_RATE, type ForcedGrid } from "./bpm";
import type { AnalyzeRequest, AnalyzeResponse, WaveformRequest } from "./analyze.worker";
import type { Waveform } from "./waveform";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<string, { resolve: (msg: AnalyzeResponse & { ok: true }) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./analyze.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const msg = event.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg.error));
    };
    worker.onerror = (event) => {
      for (const p of pending.values()) p.reject(new Error(event.message || "Analysis worker crashed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Decode a file resampled to 11 kHz (enough for beat detection). */
async function decodeForAnalysis(file: Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  // An OfflineAudioContext decodes at its own sample rate; length is irrelevant.
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  return ctx.decodeAudioData(bytes);
}

export async function analyzeFile(file: Blob, tagBpm: number | null, forced: ForcedGrid | null = null): Promise<TrackAnalysis> {
  const buffer = await decodeForAnalysis(file);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  const id = `a${++seq}`;
  const w = getWorker();
  return new Promise<TrackAnalysis>((resolve, reject) => {
    pending.set(id, { resolve: (msg) => ("analysis" in msg ? resolve(msg.analysis) : reject(new Error("Unexpected reply"))), reject });
    const req: AnalyzeRequest = { id, channels, sampleRate: buffer.sampleRate, tagBpm, forced };
    w.postMessage(req, channels.map((c) => c.buffer));
  });
}

/** A song's detailed waveform (see waveform.ts), computed in the analysis worker from a file decoded at 11 kHz. */
export async function waveformOf(file: Blob): Promise<Waveform> {
  const buffer = await decodeForAnalysis(file);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  const id = `w${++seq}`;
  const w = getWorker();
  return new Promise<Waveform>((resolve, reject) => {
    pending.set(id, { resolve: (msg) => ("wave" in msg ? resolve(msg.wave) : reject(new Error("Unexpected reply"))), reject });
    const req: WaveformRequest = { kind: "waveform", id, channels, sampleRate: buffer.sampleRate };
    w.postMessage(req, channels.map((c) => c.buffer));
  });
}
