"use client";

import { useMemo, useState } from "react";
import { drops } from "@/lib/analysis/structure";
import { libraryLoudness, trimDb } from "@/lib/analysis/loudness";
import { duplicateCounts, trackIssues, type Issue } from "@/lib/library/issues";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { TrackEditor } from "./TrackEditor";

type Filter = "all" | "attention" | "favourite" | "ban";

/** Every track with its analysis, filters for problems and admin flags, and the track editor. */
export function TrackTable() {
  const tracks = useLibrary((s) => s.tracks);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [crate, setCrate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const list = useMemo(() => Object.values(tracks).sort((a, b) => a.path.localeCompare(b.path)), [tracks]);
  const target = useMemo(() => libraryLoudness(list.map((t) => t.analysis?.loudness)), [list]);
  const issues = useMemo(() => {
    const dupes = duplicateCounts(list);
    return new Map(list.map((t) => [t.id, trackIssues(t, dupes, target)]));
  }, [list, target]);
  const crates = useMemo(() => [...new Set(list.flatMap((t) => t.crates ?? []))].sort(), [list]);
  const counts = useMemo(() => {
    const c = { ready: 0, pending: 0, error: 0, attention: 0, favourite: 0, ban: 0 };
    for (const t of list) {
      c[t.status]++;
      if (issues.get(t.id)?.length) c.attention++;
      if (t.flag) c[t.flag]++;
    }
    return c;
  }, [list, issues]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(
      (t) =>
        (!q || `${t.title} ${t.artist} ${t.path}`.toLowerCase().includes(q)) &&
        (!crate || t.crates?.includes(crate)) &&
        (filter === "all" || (filter === "attention" ? !!issues.get(t.id)?.length : t.flag === filter)),
    );
  }, [list, query, crate, filter, issues]);

  const tabs: [Filter, string, number][] = [
    ["all", "All", list.length],
    ["attention", "Needs attention", counts.attention],
    ["favourite", "Favourites", counts.favourite],
    ["ban", "Never play", counts.ban],
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Tracks</h2>
        <p className="text-sm text-muted">
          {counts.ready} ready · {counts.pending} pending · {counts.error} failed
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search tracks"
          className="h-10 w-56 rounded-lg border border-border bg-surface-2 px-3 outline-none focus:border-accent"
        />
        <div className="flex gap-1" role="tablist" aria-label="Filter tracks">
          {tabs.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-2 text-sm ${filter === key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {label} <span className={key === "attention" && n > 0 ? "text-warn" : ""}>{n}</span>
            </button>
          ))}
        </div>
        {crates.length > 0 && (
          <select
            value={crate}
            onChange={(e) => setCrate(e.target.value)}
            aria-label="Crate"
            className="h-10 rounded-lg border border-border bg-surface-2 px-3"
          >
            <option value="">All crates</option>
            {crates.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface-2 text-muted">
            <tr>
              <th className="px-5 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Artist</th>
              <th className="px-3 py-2 text-right font-medium">BPM</th>
              <th className="px-3 py-2 font-medium">Key</th>
              <th className="px-3 py-2 text-right font-medium">Gain</th>
              <th className="px-3 py-2 text-right font-medium">Drops</th>
              <th className="px-3 py-2 text-right font-medium">Grid</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <TrackRow key={t.id} track={t} target={target} issues={issues.get(t.id) ?? []} onEdit={() => setEditing(t.id)} />
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-muted">
                  {list.length === 0 ? "No tracks yet. Choose the folder with your downloaded music." : "No tracks match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <TrackEditor trackId={editing} crates={crates} onClose={() => setEditing(null)} />}
    </section>
  );
}

const KEY_SOURCE: Record<NonNullable<Track["keySource"]>, string> = { tag: "", audio: "detected", manual: "set by hand" };

function TrackRow({ track: t, target, issues, onEdit }: { track: Track; target: number; issues: Issue[]; onEdit: () => void }) {
  const a = t.analysis;
  const trim = a ? trimDb(a.loudness, target) : 0;
  return (
    <tr className={`border-t border-border ${t.flag === "ban" ? "opacity-50" : ""}`}>
      <td className="max-w-xs px-5 py-2" title={t.path}>
        <p className="truncate">
          {t.flag === "favourite" && <span className="mr-1 text-warn" aria-label="Favourite">★</span>}
          {t.flag === "ban" && <span className="mr-1 text-bad" aria-label="Never play">⛔</span>}
          {t.title}
        </p>
        {t.crates && <p className="truncate text-xs text-muted">{t.crates.join(" · ")}</p>}
      </td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-muted">{t.artist || "—"}</td>
      <td className="px-3 py-2 text-right font-mono">
        {a ? a.bpm.toFixed(1) : "—"}
        {t.overrides?.bpm && <span className="ml-1 text-xs text-accent" title="Beat grid fixed by hand">✎</span>}
      </td>
      <td className="px-3 py-2 font-mono">
        {t.camelot ?? "—"}
        {t.keySource && KEY_SOURCE[t.keySource] && <span className="ml-1 font-sans text-xs text-muted">{KEY_SOURCE[t.keySource]}</span>}
      </td>
      <td className="px-3 py-2 text-right font-mono text-muted">{a?.loudness !== undefined ? `${trim > 0 ? "+" : ""}${trim.toFixed(1)} dB` : "—"}</td>
      <td className="px-3 py-2 text-right font-mono">{a?.barLevels ? drops(a.barLevels, a.fullLevel).length : "—"}</td>
      <td className={`px-3 py-2 text-right font-mono ${a && a.beatConfidence < 0.35 ? "text-warn" : ""}`}>
        {a ? `${Math.round(a.beatConfidence * 100)}%` : "—"}
      </td>
      <td className="max-w-[16rem] px-3 py-2">
        {t.status === "pending" && <span className="text-muted">Analysing…</span>}
        {t.status === "error" && <span className="text-bad">Failed</span>}
        {t.status === "ready" && issues.length === 0 && <span className="text-good">Ready</span>}
        {t.status === "ready" && issues.length > 0 && (
          <span className="block truncate text-warn" title={issues.map((i) => i.message).join("\n")}>
            {issues[0].message}
            {issues.length > 1 && ` +${issues.length - 1}`}
          </span>
        )}
      </td>
      <td className="px-5 py-2 text-right">
        <button type="button" className="btn" onClick={onEdit} disabled={!a && t.status !== "error"}>
          Edit
        </button>
      </td>
    </tr>
  );
}
