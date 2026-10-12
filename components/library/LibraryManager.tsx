"use client";

import { useEffect, useMemo, useState } from "react";
import { canPickFolders } from "@/lib/library/scan";
import { MAX_DECKS, MIN_DECKS, type Track } from "@/lib/types";
import { useLibrary } from "@/store/library";

const DECK_HELP: Record<number, string> = {
  2: "Standard A/B mixing. Any modern laptop.",
  3: "Adds a standby deck with a track ready for instant recovery. Mid-range laptop or mini-PC.",
  4: "Reserves a fourth deck for layered blends. Stronger CPU, 16 GB RAM suggested.",
};

export function LibraryManager() {
  const s = useLibrary();
  const { hydrate } = s;
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const [supported, setSupported] = useState(true);
  useEffect(() => {
    // Checked after mount: the server render can't know the browser.
    const id = requestAnimationFrame(() => setSupported(canPickFolders()));
    return () => cancelAnimationFrame(id);
  }, []);

  const list = useMemo(
    () => Object.values(s.tracks).sort((a, b) => a.path.localeCompare(b.path)),
    [s.tracks],
  );
  const counts = useMemo(() => {
    const c = { ready: 0, pending: 0, error: 0 };
    for (const t of list) c[t.status]++;
    return c;
  }, [list]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      {!supported && (
        <p className="rounded-xl border border-bad/40 bg-bad/10 px-5 py-4">
          This browser can&apos;t open folders. Use Chrome or Edge on a computer for the booth.
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 md:col-span-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Music folder</h2>
          <p className="mt-2 text-lg">
            {s.folder ? s.folder.name : "Not connected"}
            {s.folderState === "needs-permission" && <span className="ml-2 text-sm text-warn">(access needed)</span>}
          </p>
          <p className="mt-1 text-sm text-muted">
            Use tracks your club is licensed to play in public. Files stay on this computer; only their analysis is
            saved in the browser.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => s.chooseFolder()} disabled={!supported || s.scanning} className="btn-primary">
              {s.folder ? "Choose another folder" : "Choose music folder"}
            </button>
            {s.folderState === "needs-permission" && (
              <button type="button" onClick={async () => { if (await s.reconnect()) await s.rescan(); }} className="btn">
                Allow access
              </button>
            )}
            {s.folderState === "ready" && (
              <button type="button" onClick={() => s.rescan()} disabled={s.scanning} className="btn">
                {s.scanning ? "Scanning…" : "Rescan for new files"}
              </button>
            )}
            <label className="btn cursor-pointer">
              Add files (this session only)
              <input
                type="file"
                accept="audio/*"
                multiple
                className="sr-only"
                data-testid="session-files"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void s.addSessionFiles(files);
                }}
              />
            </label>
            {counts.error > 0 && (
              <button type="button" onClick={() => s.retryFailed()} className="btn">
                Retry {counts.error} failed
              </button>
            )}
          </div>
          {s.error && <p className="mt-3 text-sm text-bad">{s.error}</p>}
          {s.analysis && (
            <div className="mt-4">
              <p className="text-sm text-muted">
                Analysing {s.analysis.done + 1} of {s.analysis.total}: {s.analysis.current}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(s.analysis.done / Math.max(1, s.analysis.total)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Decks</h2>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Number of decks">
            {Array.from({ length: MAX_DECKS - MIN_DECKS + 1 }, (_, i) => MIN_DECKS + i).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={s.settings.deckCount === n}
                onClick={() => s.setDeckCount(n)}
                className={`h-12 w-12 rounded-xl border text-lg font-semibold ${
                  s.settings.deckCount === n ? "border-accent bg-accent/20" : "border-border bg-surface-2"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">{DECK_HELP[s.settings.deckCount]}</p>
          <p className="mt-1 text-xs text-muted">Takes effect the next time Play is pressed.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Tracks</h2>
          <p className="text-sm text-muted">
            {counts.ready} ready · {counts.pending} pending · {counts.error} failed
          </p>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Artist</th>
                <th className="px-3 py-2 text-right font-medium">BPM</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 text-right font-medium">Energy</th>
                <th className="px-3 py-2 text-right font-medium">Grid</th>
                <th className="px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <TrackRow key={t.id} track={t} />
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    No tracks yet. Choose the folder with your downloaded music.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function TrackRow({ track: t }: { track: Track }) {
  const a = t.analysis;
  return (
    <tr className="border-t border-border">
      <td className="max-w-xs truncate px-5 py-2" title={t.path}>
        {t.title}
      </td>
      <td className="max-w-[12rem] truncate px-3 py-2 text-muted">{t.artist || "—"}</td>
      <td className="px-3 py-2 text-right font-mono">{a ? a.bpm.toFixed(1) : "—"}</td>
      <td className="px-3 py-2 font-mono">{t.camelot ?? "—"}</td>
      <td className="px-3 py-2 text-right font-mono">{a ? a.energy.toFixed(2) : "—"}</td>
      <td className={`px-3 py-2 text-right font-mono ${a && a.beatConfidence < 0.35 ? "text-warn" : ""}`}>
        {a ? `${Math.round(a.beatConfidence * 100)}%` : "—"}
      </td>
      <td className="px-5 py-2">
        {t.status === "ready" && <span className="text-good">Ready</span>}
        {t.status === "pending" && <span className="text-muted">Pending</span>}
        {t.status === "error" && (
          <span className="text-bad" title={t.error}>
            Failed
          </span>
        )}
      </td>
    </tr>
  );
}
