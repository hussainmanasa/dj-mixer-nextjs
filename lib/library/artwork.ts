// Cover art for the booth's jog wheels: the picture embedded in a song's tags
// (ID3 APIC, MP4 covr, FLAC / Vorbis PICTURE), cropped square, shrunk to a
// small WebP and kept in IndexedDB, so each file's tags are read only once.
// Client-only.

import { parseBlob } from "music-metadata";
import type { Track } from "@/lib/types";
import { loadArt, saveArt } from "./store";

/** Thumbnail size (px): sharp on a 15 rem jog wheel at 2× density. */
const SIZE = 320;
const urls = new Map<string, Promise<string | null>>();

/** An object URL for the song's cover art, or null if it has none (or the file can't be read). */
export function artworkUrl(track: Track, getFile: (t: Track) => Promise<File>): Promise<string | null> {
  let url = urls.get(track.id);
  if (!url) {
    url = load(track, getFile).catch(() => null);
    urls.set(track.id, url);
  }
  return url;
}

async function load(track: Track, getFile: (t: Track) => Promise<File>): Promise<string | null> {
  const saved = await loadArt(track.id);
  if (saved === false) return null;
  if (saved) return URL.createObjectURL(saved);
  const meta = await parseBlob(await getFile(track), { duration: false, skipPostHeaders: true });
  const pictures = meta.common.picture ?? [];
  const pic = pictures.find((p) => /front/i.test(p.type ?? "")) ?? pictures[0];
  const thumb = pic ? await shrink(new Blob([new Uint8Array(pic.data)], { type: pic.format })) : null;
  await saveArt(track.id, thumb ?? false);
  return thumb ? URL.createObjectURL(thumb) : null;
}

/** Centre-crop to a square and scale to SIZE; null if the browser can't decode the picture. */
async function shrink(image: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    bitmap.close();
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  } catch {
    return null;
  }
}
