"use client";

import { useRef } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { SCHEDULE_MARGIN } from "@/lib/dj/autodj";
import { entryOptions } from "@/lib/dj/cues";
import type { EntryChoice, Track } from "@/lib/types";
import { formatTime, setText, useBoothFrame } from "./frame";
import { JogWheel } from "./JogWheel";
import { DECK_LETTERS } from "./theme";
import { TrackOverview } from "./TrackOverview";

/** `loaded`: staff loaded a song before Play. */
export type DeckRole = "live" | "incoming" | "standby" | "idle" | "loaded";

const ENTRY_LABEL: Record<EntryChoice["kind"], string> = {
  auto: "Auto",
  beginning: "Beginning",
  dialogue: "Dialogue",
  hook: "Hook",
  drop: "Drop",
  bar: "Bar",
};

const ROLE_LABEL: Record<DeckRole, string> = {
  live: "On air",
  incoming: "Cued",
  standby: "Standby",
  idle: "Empty",
  loaded: "Loaded",
};

/**
 * One deck as the auto-DJ is running it: jog wheel, tempo, fader and bass
 * meters, and the track overview. The only control is choosing the track for
 * a deck that isn't on air (`onChoose`); the auto-DJ mixes it in.
 */
export function DeckPanel({
  deck,
  role,
  track,
  color,
  onChoose,
  onEject,
  keyLock = false,
  entry,
}: {
  deck: number;
  role: DeckRole;
  track: Track | null;
  color: string;
  onChoose?: { label: string; open: () => void };
  /** Take a song loaded before Play off the deck. */
  onEject?: () => void;
  /** Key-lock is running: tempo changes don't change pitch. */
  keyLock?: boolean;
  /** Cued deck only: where the song comes in ("Start from"), and how to change it. */
  entry?: { choice: EntryChoice; startAt: number; set: (choice: EntryChoice) => void };
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const fader = useRef<HTMLDivElement>(null);
  const bass = useRef<HTMLSpanElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const startFrom = useRef<HTMLDivElement>(null);
  const a = track?.analysis ?? null;

  useBoothFrame((snap) => {
    const view = snap?.decks[deck] ?? null;
    let label = ROLE_LABEL[role];
    if (snap?.mix && snap.now >= snap.mix.start) {
      if (role === "incoming") label = "Mixing in";
      if (role === "live") label = "Mixing out";
    }
    setText(badge.current, label);
    // Once this deck's mix is (about to be) under way, its track can't change.
    // Once this deck's mix is (about to be) under way, its track and start can't change.
    const locked = role === "incoming" && !!snap?.mix && snap.now >= snap.mix.start - SCHEDULE_MARGIN;
    if (choose.current) choose.current.style.display = locked ? "none" : "";
    if (startFrom.current) startFrom.current.style.display = locked ? "none" : "";
    const rate = view?.rate ?? 1;
    setText(bpm.current, a ? (a.bpm * rate).toFixed(1) : "—");
    const pct = (rate - 1) * 100;
    // Tempo change from the track's own BPM (beat-matching). With key-lock on, pitch stays put.
    setText(tempo.current, view && Math.abs(pct) >= 0.05 ? `tempo ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "BPM");
    setText(time.current, a ? `${formatTime(view?.position ?? 0)} / −${formatTime(a.duration - (view?.position ?? 0))}` : "");
    if (fader.current) fader.current.style.transform = `scaleY(${view ? view.fader : 0})`;
    if (bass.current) {
      const on = view ? Math.max(0, Math.min(1, 1 - view.bassDb / EQ_KILL_DB)) : 0;
      bass.current.style.opacity = String(0.2 + on * 0.8);
    }
  });

  const active = role === "live" || role === "incoming" || role === "loaded";
  return (
    <section
      aria-label={`Deck ${DECK_LETTERS[deck]}`}
      className={`flex min-w-0 flex-col gap-4 rounded-3xl border bg-surface/80 p-5 backdrop-blur transition-opacity ${
        active ? "opacity-100" : "opacity-60"
      }`}
      style={{ borderColor: role === "live" ? color : "var(--border)" }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">Deck {DECK_LETTERS[deck]}</h3>
          {keyLock && (
            <span
              className="rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ borderColor: color, color }}
              title="Key lock: the track keeps its original key while its tempo is matched"
            >
              Key lock
            </span>
          )}
        </div>
        <span
          ref={badge}
          className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
          style={role === "live" || role === "loaded" ? { background: color, color: "#07070b" } : { background: "var(--surface-2)", color: "var(--muted)" }}
        >
          {ROLE_LABEL[role]}
        </span>
      </header>

      <div className="flex items-stretch gap-4">
        <div className="mx-auto w-full max-w-[15rem] flex-1">
          <JogWheel deck={deck} track={track} color={color}>
            <div>
              <span ref={bpm} className="block font-mono text-2xl font-bold tabular-nums">
                —
              </span>
              <span ref={tempo} className="block font-mono text-xs text-muted">
                BPM
              </span>
            </div>
          </JogWheel>
        </div>
        <div className="flex w-10 flex-col items-center gap-2" aria-hidden>
          <div className="relative w-3 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div ref={fader} className="absolute inset-0 origin-bottom rounded-full" style={{ background: color, transform: "scaleY(0)" }} />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted">Vol</span>
          <span ref={bass} className="rounded px-1 text-[10px] font-bold uppercase" style={{ background: color, color: "#07070b", opacity: 0.2 }}>
            Bass
          </span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{track?.title ?? "—"}</p>
            <p className="truncate text-muted">{track ? track.artist || "Unknown artist" : "Waiting for a track"}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {onChoose && (
              <button ref={choose} type="button" onClick={onChoose.open} className="btn">
                {onChoose.label}
              </button>
            )}
            {onEject && (
              <button type="button" onClick={onEject} className="btn" aria-label={`Eject Deck ${DECK_LETTERS[deck]}`}>
                Eject
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 flex justify-between font-mono text-sm text-muted">
          <span>{track?.camelot ?? "key —"}</span>
          <span ref={time} className="tabular-nums" />
        </p>
        {entry && track && (
          <div ref={startFrom} className="mt-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Start from">
            <span className="mr-1 text-xs uppercase tracking-wider text-muted">Start from</span>
            {entryOptions(track).map((kind) => {
              const on = entry.choice.kind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => entry.set({ kind } as EntryChoice)}
                  className="rounded-full border px-3 py-1 text-xs font-semibold"
                  style={on ? { borderColor: color, background: color, color: "#07070b" } : { borderColor: "var(--border)", color: "var(--muted)" }}
                >
                  {ENTRY_LABEL[kind]}
                </button>
              );
            })}
            {entry.choice.kind === "bar" && (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: color, color: "#07070b" }}>
                Bar {entry.choice.bar + 1}
              </span>
            )}
          </div>
        )}
      </div>

      <TrackOverview
        deck={deck}
        track={track}
        color={color}
        live={role === "live"}
        startAt={entry?.startAt}
        onPickBar={entry ? (bar) => entry.set({ kind: "bar", bar }) : undefined}
      />
    </section>
  );
}
