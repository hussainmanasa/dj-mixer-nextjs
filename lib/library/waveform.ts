// A song's detailed waveform for the booth's track view: built once (decoded
// at the analysis rate, computed in the analysis worker) and kept in IndexedDB,
// so a song that has played before shows at once. Client-only.

import { waveformOf } from "@/lib/analysis/analyze";
import type { Waveform } from "@/lib/analysis/waveform";
import type { Track } from "@/lib/types";
import { loadWave, saveWave } from "./store";

/** Waveforms kept in memory (the decks' songs and a few before them; ~60 KB each). */
const KEEP = 12;
const cache = new Map<string, Promise<Waveform | null>>();

/** The song's waveform, or null if its file can't be read. */
export function waveformFor(track: Track, getFile: (t: Track) => Promise<File>): Promise<Waveform | null> {
  let w = cache.get(track.id);
  if (!w) {
    w = build(track, getFile).catch((err: unknown) => {
      console.warn(`Couldn't build the waveform of "${track.title}"`, err);
      return null;
    });
    cache.set(track.id, w);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  }
  return w;
}

async function build(track: Track, getFile: (t: Track) => Promise<File>): Promise<Waveform | null> {
  const saved = await loadWave(track.id);
  if (saved) return saved;
  const wave = await waveformOf(await getFile(track));
  await saveWave(track.id, wave);
  return wave;
}
