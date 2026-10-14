"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useMoods } from "@/store/library";
import { useSession } from "@/store/session";

/**
 * Staff choose a track. Sorted by how well it fits the mood and the playing
 * track; the auto-DJ still beat-matches it and mixes it in for the mood.
 */
export function TrackPicker({
  next,
  loadDeck,
  color,
  onClose,
}: {
  next: boolean;
  /** Load into this deck (before Play) instead of requesting. */
  loadDeck?: number;
  color: string;
  onClose: () => void;
}) {
  const rankTracks = useSession((s) => s.rankTracks);
  const request = useSession((s) => s.request);
  const load = useSession((s) => s.loadDeck);
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.track.title} ${o.track.artist}`.toLowerCase().includes(q));
  }, [options, query]);

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
              {loadDeck !== undefined ? `Load a track into Deck ${"ABCD"[loadDeck]}` : next ? "Choose the next track" : "Add a track to the queue"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Best fit for {mood.name} first. The auto-DJ beat-matches it and mixes it in for the mood.
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
              <li key={o.track.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (loadDeck !== undefined) load(loadDeck, o.track.id);
                    else request(o.track.id, next);
                    onClose();
                  }}
                  className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left hover:bg-surface-2"
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
          {shown.length === 0 && <li className="px-3 py-10 text-center text-muted">No matching tracks.</li>}
        </ul>
      </div>
    </div>
  );
}
