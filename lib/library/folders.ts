// The music folder as a tree, for the Library's Folders view: each folder with
// its subfolders, its songs and how many of them (in it and below) are ready,
// still analysing or failed. PURE.

import type { Track } from "@/lib/types";

/** Songs added with "Add files (this session only)" have no folder: they go here. */
export const SESSION_FOLDER = "Added this session";

export interface FolderNode {
  /** Folder name ("" for the music folder itself). */
  name: string;
  /** Path from the music folder, e.g. "Bollywood/Romantic" ("" for the root). */
  path: string;
  folders: FolderNode[];
  /** Songs directly in this folder, by file name. */
  tracks: Track[];
  /** Songs in this folder and all below it. */
  counts: { total: number; ready: number; pending: number; error: number };
}

const node = (name: string, path: string): FolderNode => ({
  name,
  path,
  folders: [],
  tracks: [],
  counts: { total: 0, ready: 0, pending: 0, error: 0 },
});

/** Build the tree from track paths ("House/Deep/song.mp3"); folders and songs sorted by name. */
export function folderTree(tracks: Track[]): FolderNode {
  const root = node("", "");
  const byPath = new Map<string, FolderNode>([["", root]]);
  const folderOf = (parts: string[]): FolderNode => {
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = byPath.get(path);
      if (!next) {
        next = node(parts[i], path);
        byPath.set(path, next);
        cur.folders.push(next);
      }
      cur = next;
    }
    return cur;
  };
  for (const t of tracks) {
    const session = t.path.startsWith("session:");
    const parts = session ? [SESSION_FOLDER] : t.path.split("/").slice(0, -1).filter(Boolean);
    folderOf(parts).tracks.push(t);
    // Count the song in its folder and every folder above it.
    for (let i = parts.length; i >= 0; i--) {
      const f = byPath.get(parts.slice(0, i).join("/"))!;
      f.counts.total++;
      f.counts[t.status]++;
    }
  }
  const sort = (f: FolderNode) => {
    f.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    f.tracks.sort((a, b) => fileName(a).localeCompare(fileName(b), undefined, { numeric: true, sensitivity: "base" }));
    f.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function fileName(t: Track): string {
  return t.path.replace(/^session:/, "").split("/").pop() ?? t.path;
}

/** Every folder path in the tree (for "Expand all"). */
export function folderPaths(f: FolderNode): string[] {
  return f.folders.flatMap((c) => [c.path, ...folderPaths(c)]);
}
