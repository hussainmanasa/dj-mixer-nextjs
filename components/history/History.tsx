"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { groupNights, localTime, toCsv, type Night } from "@/lib/library/setlog";
import { clearSetLog, loadSetLog } from "@/lib/library/store";
import type { SetLogEntry } from "@/lib/types";
import { useMoods } from "@/store/library";

const HOW_LABEL: Record<SetLogEntry["how"], string> = {
  start: "Set start",
  recovery: "Recovery",
  blend: "Blend",
  filterSweep: "Filter sweep",
  echoOut: "Echo-out",
  cut: "Cut",
  drop: "Drop swap",
  dialogue: "Dialogue → drop",
  rewind: "Rewind",
  layer: "Layer",
};

function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Every track the booth played, by night, with CSV export for licence reports. */
export function History() {
  const [log, setLog] = useState<SetLogEntry[] | null>(null);
  const moods = useMoods();
  const [open, setOpen] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(() => {
    void loadSetLog().then(setLog);
  }, []);
  // Reload on show: this page stays mounted (hidden) between visits.
  useEffect(() => {
    reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const nights = useMemo(() => (log ? groupNights(log) : []), [log]);
  const shown: Night | undefined = nights.find((n) => n.night === open) ?? nights[0];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          Every track the booth played, grouped by night (tracks after midnight count toward the evening before). Export
          a night as CSV for your public performance licence reports.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={reload}>
            Refresh
          </button>
          <button type="button" className="btn-primary" disabled={nights.length === 0} onClick={() => download("set-log-all.csv", toCsv(nights))}>
            Export all (CSV)
          </button>
        </div>
      </section>

      {log && nights.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface px-5 py-10 text-center text-muted">Nothing played yet.</p>
      )}

      {shown && (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <nav aria-label="Nights" className="flex flex-col gap-1">
            {nights.map((n) => (
              <button
                key={n.night}
                type="button"
                onClick={() => setOpen(n.night)}
                className={`rounded-xl px-4 py-3 text-left ${n.night === shown.night ? "bg-surface-2" : "hover:bg-surface"}`}
              >
                <span className="block font-semibold">{n.night}</span>
                <span className="text-xs text-muted">
                  {n.entries.length} tracks · {duration(n.totalSec)}
                </span>
              </button>
            ))}
          </nav>

          <section className="rounded-2xl border border-border bg-surface">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-lg font-semibold">Night of {shown.night}</h2>
              <button type="button" className="btn" onClick={() => download(`set-log-${shown.night}.csv`, toCsv([shown]))}>
                Export night (CSV)
              </button>
            </div>
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-2 text-muted">
                  <tr>
                    <th className="px-5 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Track</th>
                    <th className="px-3 py-2 font-medium">Mood</th>
                    <th className="px-3 py-2 font-medium">Came in by</th>
                    <th className="px-5 py-2 text-right font-medium">Played</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.entries.map((e, i) => (
                    <tr key={`${e.at}-${i}`} className="border-t border-border">
                      <td className="px-5 py-2 font-mono text-muted">{localTime(e.at).slice(11, 16)}</td>
                      <td className="max-w-md px-3 py-2">
                        <p className="truncate">
                          {e.title}
                          {e.requested && <span className="ml-2 text-xs text-accent">requested</span>}
                        </p>
                        <p className="truncate text-xs text-muted">{e.artist || "Unknown artist"}</p>
                      </td>
                      <td className="px-3 py-2 text-muted">{moods.find((m) => m.id === e.mood)?.name ?? e.mood}</td>
                      <td className="px-3 py-2 text-muted">{HOW_LABEL[e.how]}</td>
                      <td className="px-5 py-2 text-right font-mono text-muted">
                        {e.playedSec === null ? "—" : `${Math.floor(e.playedSec / 60)}:${String(e.playedSec % 60).padStart(2, "0")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {nights.length > 0 && (
        <div className="flex justify-end">
          {confirmClear ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-warn">Delete the whole log? Export it first if you need it.</span>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn border-bad text-bad"
                onClick={async () => {
                  await clearSetLog();
                  setConfirmClear(false);
                  reload();
                }}
              >
                Delete log
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmClear(true)}>
              Clear log…
            </button>
          )}
        </div>
      )}
    </main>
  );
}
