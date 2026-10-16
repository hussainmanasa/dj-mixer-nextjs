"use client";

import { Fragment, useMemo, useState } from "react";
import { drops } from "@/lib/analysis/structure";
import { libraryLoudness, trimDb } from "@/lib/analysis/loudness";
import { folderPaths, folderTree, SESSION_FOLDER, type FolderNode } from "@/lib/library/folders";
import { duplicateCounts, trackIssues, type Issue } from "@/lib/library/issues";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { TrackEditor } from "./TrackEditor";

type Filter = "all" | "attention" | "favourite" | "ban";

/**
 * Every track with its analysis, filters for problems and admin flags, and the
 * track editor. Folders view (default) shows the music folder as it is on disk —
 * folders and subfolders that open and close, each with its songs and how far
 * their analysis has got; List view is every song in one list.
 */
export function TrackTable() {
  const tracks = useLibrary((s) => s.tracks);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [crate, setCrate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<"folders" | "list">("folders");
  // Folders start closed — except the files just added for this session.
  const [open, setOpen] = useState<Set<string>>(() => new Set([SESSION_FOLDER]));

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

  const tree = useMemo(() => folderTree(shown), [shown]);
  // Searching or filtering opens every folder that has a match.
  const narrowed = !!query.trim() || filter !== "all" || !!crate;
  const isOpen = (path: string) => narrowed || open.has(path);
  const toggle = (path: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const rowFor = (t: Track, depth: number) => (
    <TrackRow key={t.id} track={t} depth={depth} target={target} issues={issues.get(t.id) ?? []} onEdit={() => setEditing(t.id)} />
  );
  const folderRows = (f: FolderNode, depth: number): React.ReactNode[] =>
    f.folders.map((c) => (
      <Fragment key={c.path}>
        <FolderRow folder={c} depth={depth} open={isOpen(c.path)} onToggle={() => toggle(c.path)} />
        {isOpen(c.path) && [...folderRows(c, depth + 1), ...c.tracks.map((t) => rowFor(t, depth + 1))]}
      </Fragment>
    ));

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
        <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label="View">
          {(["folders", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-2 text-sm ${view === v ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {v === "folders" ? "Folders" : "List"}
            </button>
          ))}
          {view === "folders" && tree.folders.length > 0 && (
            <>
              <button type="button" className="btn" onClick={() => setOpen(new Set(folderPaths(tree)))} disabled={narrowed}>
                Expand all
              </button>
              <button type="button" className="btn" onClick={() => setOpen(new Set())} disabled={narrowed}>
                Collapse all
              </button>
            </>
          )}
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
            {view === "list" ? shown.map((t) => rowFor(t, 0)) : [...folderRows(tree, 0), ...tree.tracks.map((t) => rowFor(t, 0))]}
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

/** A folder in the Folders view: opens and closes, with its song count and analysis progress (it and below). */
function FolderRow({ folder: f, depth, open, onToggle }: { folder: FolderNode; depth: number; open: boolean; onToggle: () => void }) {
  const { total, ready, pending, error } = f.counts;
  const done = ready + error;
  return (
    <tr className="border-t border-border bg-surface-2/40">
      <td colSpan={9} className="py-1.5 pr-5" style={{ paddingLeft: 20 + depth * 20 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left"
          aria-label={`${open ? "Close" : "Open"} folder ${f.name}`}
        >
          <span className="w-3 text-muted" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span aria-hidden>📁</span>
          <span className="truncate font-semibold">{f.name}</span>
          <span className="shrink-0 text-xs text-muted">
            {total} song{total === 1 ? "" : "s"}
            {pending > 0 && <span> · {pending} analysing</span>}
            {error > 0 && <span className="text-bad"> · {error} failed</span>}
          </span>
          {pending > 0 && (
            <span className="ml-auto h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-surface" aria-hidden>
              <span className="block h-full bg-accent" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
            </span>
          )}
        </button>
      </td>
    </tr>
  );
}

function TrackRow({
  track: t,
  depth = 0,
  target,
  issues,
  onEdit,
}: {
  track: Track;
  /** Folders view: how deep it sits (indents the title). */
  depth?: number;
  target: number;
  issues: Issue[];
  onEdit: () => void;
}) {
  const a = t.analysis;
  const trim = a ? trimDb(a.loudness, target) : 0;
  return (
    <tr className={`border-t border-border ${t.flag === "ban" ? "opacity-50" : ""}`}>
      <td className="max-w-xs py-2 pr-5" title={t.path.replace(/^session:/, "")} style={{ paddingLeft: 20 + depth * 20 + (depth > 0 ? 16 : 0) }}>
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
