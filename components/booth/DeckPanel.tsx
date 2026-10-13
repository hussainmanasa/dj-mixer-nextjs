"use client";

import { useRef } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { SCHEDULE_MARGIN } from "@/lib/dj/autodj";
import type { Track } from "@/lib/types";
import { formatTime, setText, useBoothFrame } from "./frame";
import { JogWheel } from "./JogWheel";
import { DECK_LETTERS } from "./theme";
import { TrackOverview } from "./TrackOverview";

export type DeckRole = "live" | "incoming" | "standby" | "idle";

const ROLE_LABEL: Record<DeckRole, string> = {
  live: "On air",
  incoming: "Cued",
  standby: "Standby",
  idle: "Empty",
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
}: {
  deck: number;
  role: DeckRole;
  track: Track | null;
  color: string;
  onChoose?: { label: string; open: () => void };
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const pitch = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const fader = useRef<HTMLDivElement>(null);
  const bass = useRef<HTMLSpanElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
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
    if (choose.current) {
      const locked = role === "incoming" && !!snap?.mix && snap.now >= snap.mix.start - SCHEDULE_MARGIN;
      choose.current.style.display = locked ? "none" : "";
    }
    const rate = view?.rate ?? 1;
    setText(bpm.current, a ? (a.bpm * rate).toFixed(1) : "—");
    const pct = (rate - 1) * 100;
    setText(pitch.current, view && Math.abs(pct) >= 0.05 ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "BPM");
    setText(time.current, a ? `${formatTime(view?.position ?? 0)} / −${formatTime(a.duration - (view?.position ?? 0))}` : "");
    if (fader.current) fader.current.style.transform = `scaleY(${view ? view.fader : 0})`;
    if (bass.current) {
      const on = view ? Math.max(0, Math.min(1, 1 - view.bassDb / EQ_KILL_DB)) : 0;
      bass.current.style.opacity = String(0.2 + on * 0.8);
    }
  });

  const active = role === "live" || role === "incoming";
  return (
    <section
      aria-label={`Deck ${DECK_LETTERS[deck]}`}
      className={`flex min-w-0 flex-col gap-4 rounded-3xl border bg-surface/80 p-5 backdrop-blur transition-opacity ${
        active ? "opacity-100" : "opacity-60"
      }`}
      style={{ borderColor: role === "live" ? color : "var(--border)" }}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">Deck {DECK_LETTERS[deck]}</h3>
        <span
          ref={badge}
          className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
          style={role === "live" ? { background: color, color: "#07070b" } : { background: "var(--surface-2)", color: "var(--muted)" }}
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
              <span ref={pitch} className="block font-mono text-xs text-muted">
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
          {onChoose && (
            <button ref={choose} type="button" onClick={onChoose.open} className="btn shrink-0">
              {onChoose.label}
            </button>
          )}
        </div>
        <p className="mt-1 flex justify-between font-mono text-sm text-muted">
          <span>{track?.camelot ?? "key —"}</span>
          <span ref={time} className="tabular-nums" />
        </p>
      </div>

      <TrackOverview deck={deck} track={track} color={color} live={role === "live"} />
    </section>
  );
}
