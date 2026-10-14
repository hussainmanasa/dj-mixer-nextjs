"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { dropCue } from "@/lib/dj/mixpoints";
import { hookOf } from "@/lib/dj/cues";
import type { Track } from "@/lib/types";
import { previewIsSeparate, useLibrary, useMoods } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";

/**
 * Staff choose a track. Sorted by how well it fits the mood and the playing
 * track; the auto-DJ still beat-matches it and mixes it in for the mood.
 */
export function TrackPicker({
  next,
  loadDeck,
  layer,
  color,
  onClose,
}: {
  next: boolean;
  /** Load into this deck (before Play) instead of requesting. */
  loadDeck?: number;
  /** Pick a song to layer over the playing one: only songs that match its tempo and key. */
  layer?: boolean;
  color: string;
  onClose: () => void;
}) {
  const rankTracks = useSession((s) => s.rankTracks);
  const request = useSession((s) => s.request);
  const load = useSession((s) => s.loadDeck);
  // Preview on the preview output; during a set only if that's separate from the club speakers.
  const boothPlaying = useSession((s) => s.status.playing);
  const separate = useLibrary((s) => previewIsSeparate(s.settings));
  const previewBlocked = boothPlaying && !separate;
  const stopPick = () => {
    const p = usePreview.getState();
    if (p.playing?.startsWith("pick:")) p.stop();
  };
  const layerTrack = useSession((s) => s.layer);
  const moodId = useSession((s) => s.status.mood);
  const mood = useMoods().find((m) => m.id === moodId)!;
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // Ranked once when the picker opens.
  const [options] = useState(() => rankTracks());

  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Closing the picker stops its preview.
  useEffect(
    () => () => {
      const p = usePreview.getState();
      if (p.playing?.startsWith("pick:")) p.stop();
    },
    [],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Layering two whole songs only works when tempo and key match.
    const pool = layer ? options.filter((o) => o.layerable) : options;
    if (!q) return pool;
    return pool.filter((o) => `${o.track.title} ${o.track.artist}`.toLowerCase().includes(q));
  }, [options, query, layer]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="picker-title" className="text-xl font-semibold">
              {layer
                ? "Layer a song over this one"
                : loadDeck !== undefined
                  ? `Load a track into Deck ${"ABCD"[loadDeck]}`
                  : next
                    ? "Choose the next track"
                    : "Add a track to the queue"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {layer
                ? "Only songs that match the playing one's tempo and key. It plays over this one, bass off, until you press Drop."
                : `Best fit for ${mood.name} first. The auto-DJ beat-matches it and mixes it in for the mood.`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn">
            Close
          </button>
        </header>
        <div className="px-6 pt-4">
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or artist"
            className="h-12 w-full rounded-xl border border-border bg-surface-2 px-4 text-lg outline-none focus:border-accent"
          />
        </div>
        <ul className="flex-1 overflow-auto px-3 py-3">
          {shown.map((o) => {
            const fit = Math.max(0, Math.min(1, o.score));
            return (
              <li key={o.track.id} className="flex items-center gap-2">
                <PreviewButton track={o.track} blocked={previewBlocked} />
                <button
                  type="button"
                  onClick={() => {
                    stopPick();
                    if (layer) layerTrack(o.track.id);
                    else if (loadDeck !== undefined) load(loadDeck, o.track.id);
                    else request(o.track.id, next);
                    onClose();
                  }}
                  className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-3 py-3 text-left hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{o.track.title}</p>
                    <p className="truncate text-sm text-muted">
                      {o.track.artist || "Unknown artist"}
                      {!o.syncable && <span className="ml-2 text-warn">· tempo jump, echo-out</span>}
                      {o.recent && <span className="ml-2 text-muted">· played recently</span>}
                    </p>
                  </div>
                  <span className="w-20 text-right font-mono text-sm text-muted">{o.track.analysis!.bpm.toFixed(1)}</span>
                  <span className="w-10 font-mono text-sm text-muted">{o.track.camelot ?? "—"}</span>
                  <span className="flex w-28 items-center gap-2" title={`Fit ${Math.round(fit * 100)}%`}>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${fit * 100}%`, background: color }} />
                    </span>
                    <span className="w-8 text-right font-mono text-xs text-muted">{Math.round(fit * 100)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-3 py-10 text-center text-muted">
              {layer ? "No songs match the playing one's tempo and key." : "No matching tracks."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Listen to a song's hook (else its drop) for 30 s on the preview output before choosing it. */
function PreviewButton({ track, blocked }: { track: Track; blocked: boolean }) {
  const tag = `pick:${track.id}`;
  const playing = usePreview((s) => s.playing === tag);
  const loading = usePreview((s) => s.loading);
  const play = usePreview((s) => s.play);
  const stop = usePreview((s) => s.stop);
  const getFile = useLibrary((s) => s.getFile);
  const from = hookOf(track.cues)?.start ?? dropCue(track.analysis!);
  return (
    <button
      type="button"
      className="btn h-11 w-11 shrink-0 px-0"
      disabled={blocked || (loading && !playing)}
      aria-label={`${playing ? "Stop preview of" : "Preview"} ${track.title}`}
      title={blocked ? "Choose a separate preview output (Library → Audio outputs) to preview during a set" : "Preview on the preview output"}
      onClick={() => (playing ? stop() : play(tag, async (p) => p.playFrom(await getFile(track), from, { length: 30 })))}
    >
      {playing ? "■" : "▶"}
    </button>
  );
}

