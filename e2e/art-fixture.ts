// A fixture song with cover art: a generated WAV plus an "id3 " chunk holding
// an ID3v2.3 tag with a front-cover picture (APIC), as DJ-pool WAVs often carry.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_DIR } from "./fixtures";

export const ART_DIR = join(__dirname, ".fixtures-art");
export const ART_SONG = "Cover Groove 127.wav";

function id3WithCover(png: Buffer): Buffer {
  const mime = Buffer.from("image/png\0", "latin1");
  // Text encoding 0, MIME, picture type 3 (front cover), empty description, the image.
  const body = Buffer.concat([Buffer.from([0]), mime, Buffer.from([3, 0]), png]);
  const frame = Buffer.alloc(10);
  frame.write("APIC", 0, "latin1");
  frame.writeUInt32BE(body.length, 4);
  const frames = Buffer.concat([frame, body]);
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  // Syncsafe size: 7 bits per byte.
  let n = frames.length;
  for (let i = 9; i >= 6; i--) {
    header[i] = n & 0x7f;
    n >>= 7;
  }
  return Buffer.concat([header, frames]);
}

/** Write the cover-art fixture (from "Test Groove C" and the app's own icon). */
export function makeArtFixture(): string {
  mkdirSync(ART_DIR, { recursive: true });
  const wav = readFileSync(join(FIXTURE_DIR, "Test Groove C 127.wav"));
  const tag = id3WithCover(readFileSync(join(__dirname, "..", "app", "apple-icon.png")));
  const pad = tag.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const chunk = Buffer.concat([Buffer.from("id3 ", "latin1"), Buffer.alloc(4), tag, pad]);
  chunk.writeUInt32LE(tag.length, 4);
  const out = Buffer.concat([wav, chunk]);
  out.writeUInt32LE(out.length - 8, 4);
  const path = join(ART_DIR, ART_SONG);
  writeFileSync(path, out);
  return path;
}
