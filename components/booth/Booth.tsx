"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { MOODS, getMood } from "@/lib/dj/moods";
import type { TransitionKind } from "@/lib/types";
import { readyTracks, useLibrary } from "@/store/library";
import { useSession } from "@/store/session";

const TRANSITION_LABEL: Record<TransitionKind, string> = {
  blend: "Beat-matched blend",
  filterSweep: "Filter sweep",
  echoOut: "Echo-out",
  cut: "Cut on the downbeat",
};

export function Booth() {
  const hydrateLibrary = useLibrary((s) => s.hydrate);
  const hydrateSession = useSession((s) => s.hydrate);
  useEffect(() => {
    void hydrateLibrary();
    void hydrateSession();
  }, [hydrateLibrary, hydrateSession]);

  const hydrated = useLibrary((s) => s.hydrated);
  const tracks = useLibrary((s) => s.tracks);
  const folderState = useLibrary((s) => s.folderState);
  const analysis = useLibrary((s) => s.analysis);
  const ready = readyTracks(tracks).length;

  const status = useSession((s) => s.status);
  const starting = useSession((s) => s.starting);
  const resumeAvailable = useSession((s) => s.resumeAvailable);
  const play = useSession((s) => s.play);
  const stop = useSession((s) => s.stop);
  const setMood = useSession((s) => s.setMood);

  const canPlay = hydrated && ready >= 2;
  const tryAutoResume = useSession((s) => s.tryAutoResume);
  useEffect(() => {
    if (canPlay && folderState === "ready" && resumeAvailable) void tryAutoResume();
  }, [canPlay, folderState, resumeAvailable, tryAutoResume]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8">
      {resumeAvailable && !status.playing && canPlay && (
        <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-warn/10 px-5 py-4">
          <p>The last set was interrupted. Press play to resume in {getMood(status.mood).name}.</p>
        </div>
      )}

      <section aria-labelledby="mood-heading">
        <h2 id="mood-heading" className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">
          Mood
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {MOODS.map((m) => {
            const active = status.mood === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMood(m.id)}
                aria-pressed={active}
                className={`rounded-2xl border px-4 py-5 text-left transition ${
                  active ? "border-accent bg-accent/20" : "border-border bg-surface hover:bg-surface-2"
                }`}
              >
                <span className="block text-lg font-semibold">{m.name}</span>
                <span className="mt-1 block text-xs text-muted">
                  {m.bpm[0]}–{m.bpm[1]} BPM
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col items-center gap-4">
        <button
          type="button"
          disabled={!canPlay || starting}
          onClick={() => (status.playing ? stop() : play())}
          className={`h-40 w-40 rounded-full text-2xl font-bold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
            status.playing ? "bg-bad text-black" : "bg-good text-black"
          }`}
        >
          {starting ? "…" : status.playing ? "Stop" : "Play"}
        </button>
        <LevelMeter />
        {!canPlay && hydrated && (
          <p className="text-center text-muted">
            {folderState === "none" && ready === 0 ? "No music folder connected. " : `Only ${ready} analysed track${ready === 1 ? "" : "s"}. `}
            <Link href="/library" className="text-accent underline">
              Open the library
            </Link>
          </p>
        )}
        {status.error && <p className="text-center text-bad">{status.error}</p>}
        {status.note && <p className="text-center text-warn">{status.note}</p>}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted">Now playing</h3>
          {status.now ? (
            <>
              <p className="mt-2 truncate text-xl font-semibold">{status.now.track.title}</p>
              <p className="truncate text-muted">{status.now.track.artist || "Unknown artist"}</p>
              <p className="mt-3 font-mono text-sm text-muted">
                {status.now.bpm.toFixed(1)} BPM · {status.now.track.camelot ?? "key —"} · Deck {status.now.deck + 1} of {status.deckCount}
              </p>
            </>
          ) : (
            <p className="mt-2 text-muted">Nothing yet</p>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted">Up next</h3>
          {status.next ? (
            <>
              <p className="mt-2 truncate text-xl font-semibold">{status.next.track.title}</p>
              <p className="truncate text-muted">{status.next.track.artist || "Unknown artist"}</p>
              <p className="mt-3 font-mono text-sm text-muted">
                {TRANSITION_LABEL[status.next.transition]} · <Countdown at={status.next.at} />
              </p>
            </>
          ) : (
            <p className="mt-2 text-muted">{status.playing ? "Choosing…" : "—"}</p>
          )}
        </div>
      </section>

      <footer className="mt-auto text-center text-xs text-muted">
        {ready} tracks ready
        {analysis ? ` · analysing ${analysis.done + 1}/${analysis.total}` : ""} · {getMood(status.mood).description}
      </footer>
    </main>
  );
}

/** Master level bar, updated every frame without re-rendering React. */
function LevelMeter() {
  const bar = useRef<HTMLDivElement>(null);
  const level = useSession((s) => s.level);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = Math.min(1, level() * 4);
      if (bar.current) bar.current.style.transform = `scaleX(${v})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <div className="h-2 w-64 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div ref={bar} className="h-full origin-left bg-gradient-to-r from-accent-2 to-accent" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}

/** "in 1:23" until an AudioContext time, updated without re-rendering. */
function Countdown({ at }: { at: number }) {
  const span = useRef<HTMLSpanElement>(null);
  const clock = useSession((s) => s.clock);
  useEffect(() => {
    const update = () => {
      const s = Math.max(0, Math.round(at - clock()));
      if (span.current) span.current.textContent = s > 0 ? `in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "mixing now";
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [at, clock]);
  return <span ref={span} />;
}
