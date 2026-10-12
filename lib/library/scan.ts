// Reading the club's downloaded music folder: walk it, identify files by a
// content hash, and read tags. Client-only (File System Access API, Web Crypto).

import { parseBlob } from "music-metadata";
import { toCamelot } from "@/lib/analysis/key";
import { SUPPORTED_EXTENSIONS, type Track } from "@/lib/types";

export interface FoundFile {
  path: string;
  file: File;
}

export function isSupported(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function canPickFolders(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error("This browser cannot open folders. Use Chrome or Edge on a computer.");
  return window.showDirectoryPicker({ id: "dj-library", mode: "read", startIn: "music" });
}

/** Make sure we may read the folder. Requesting needs a user gesture. */
export async function ensurePermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const opts = { mode: "read" as const };
  if ((await handle.queryPermission?.(opts)) === "granted") return true;
  if (!request) return false;
  return (await handle.requestPermission?.(opts)) === "granted";
}

/** Recursively list supported audio files under a folder. */
export async function* walk(dir: FileSystemDirectoryHandle, prefix = ""): AsyncGenerator<FoundFile> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      if (entry.name.startsWith(".")) continue;
      yield* walk(entry as FileSystemDirectoryHandle, path);
    } else if (isSupported(entry.name)) {
      yield { path, file: await (entry as FileSystemFileHandle).getFile() };
    }
  }
}

/** Resolve a stored relative path back to a File. */
export async function getFileAt(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  const parts = path.split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  return fh.getFile();
}

/**
 * Stable id for a file's content: SHA-256 of its size plus the first and last
 * 256 KB. Survives renames and moves; fast even for large WAVs.
 */
export async function fileId(file: File): Promise<string> {
  const chunk = 256 * 1024;
  const head = await file.slice(0, chunk).arrayBuffer();
  const tail = file.size > chunk ? await file.slice(Math.max(chunk, file.size - chunk)).arrayBuffer() : new ArrayBuffer(0);
  const size = new TextEncoder().encode(String(file.size));
  const all = new Uint8Array(size.byteLength + head.byteLength + tail.byteLength);
  all.set(size, 0);
  all.set(new Uint8Array(head), size.byteLength);
  all.set(new Uint8Array(tail), size.byteLength + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", all);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}

/** Build a pending Track from a file and its tags (tags are optional). */
export async function trackFromFile(found: FoundFile, id: string): Promise<Track> {
  let title = titleFromPath(found.file.name || found.path);
  let artist = "";
  let genres: string[] = [];
  let camelot: string | null = null;
  let tagBpm: number | null = null;
  try {
    const meta = await parseBlob(found.file, { duration: false, skipCovers: true });
    const c = meta.common;
    if (c.title) title = c.title;
    artist = c.artist ?? c.albumartist ?? "";
    genres = (c.genre ?? []).flatMap((g) => g.split(/[;,/]/)).map((g) => g.trim()).filter(Boolean);
    camelot = toCamelot(c.key);
    tagBpm = typeof c.bpm === "number" && Number.isFinite(c.bpm) ? c.bpm : null;
  } catch {
    // Unreadable tags are fine — analysis still works from the audio.
  }
  return {
    id,
    path: found.path,
    title,
    artist,
    genres,
    camelot,
    tagBpm,
    analysis: null,
    status: "pending",
    addedAt: Date.now(),
  };
}
