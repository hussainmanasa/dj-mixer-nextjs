import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { folderPaths, folderTree, SESSION_FOLDER } from "./folders";

const t = (path: string, status: Track["status"] = "ready"): Track =>
  ({ id: path, path, title: path, artist: "", genres: [], camelot: null, tagBpm: null, analysis: null, status, addedAt: 0 }) as Track;

describe("folderTree", () => {
  const tree = folderTree([
    t("Bollywood/Romantic/b.mp3"),
    t("Bollywood/Romantic/a.mp3", "pending"),
    t("Bollywood/party 10.mp3"),
    t("Bollywood/party 2.mp3", "error"),
    t("Punjabi/x.mp3"),
    t("loose.mp3"),
    t("session:extra.wav", "pending"),
  ]);

  it("keeps the folders and subfolders as they are on disk", () => {
    expect(tree.folders.map((f) => f.name)).toEqual(["Added this session", "Bollywood", "Punjabi"]);
    const bollywood = tree.folders[1];
    expect(bollywood.path).toBe("Bollywood");
    expect(bollywood.folders.map((f) => f.path)).toEqual(["Bollywood/Romantic"]);
    expect(tree.tracks.map((x) => x.path)).toEqual(["loose.mp3"]);
  });

  it("sorts songs by file name, numbers in order", () => {
    expect(tree.folders[1].tracks.map((x) => x.path)).toEqual(["Bollywood/party 2.mp3", "Bollywood/party 10.mp3"]);
    expect(tree.folders[1].folders[0].tracks.map((x) => x.path)).toEqual(["Bollywood/Romantic/a.mp3", "Bollywood/Romantic/b.mp3"]);
  });

  it("counts songs in a folder and everything below it, by status", () => {
    expect(tree.counts).toEqual({ total: 7, ready: 4, pending: 2, error: 1 });
    expect(tree.folders[1].counts).toEqual({ total: 4, ready: 2, pending: 1, error: 1 });
    expect(tree.folders[1].folders[0].counts).toEqual({ total: 2, ready: 1, pending: 1, error: 0 });
  });

  it("puts session-only files in their own folder and lists every folder path", () => {
    expect(tree.folders[0].name).toBe(SESSION_FOLDER);
    expect(tree.folders[0].tracks).toHaveLength(1);
    expect(folderPaths(tree)).toEqual(["Added this session", "Bollywood", "Bollywood/Romantic", "Punjabi"]);
  });
});
