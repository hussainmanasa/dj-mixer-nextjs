"use client";

import { useEffect, useRef, useState } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { SCHEDULE_MARGIN } from "@/lib/dj/autodj";
import { barAt, barLabel, beatBar, entryOptions, type CuePlan } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { useLibrary } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";
import type { EntryChoice, Track } from "@/lib/types";
import { formatTime, setText, useBoothFrame } from "./frame";
import { JogWheel, type JogScrub } from "./JogWheel";
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
  cue,
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
  /** Cue on the preview output (headphones): what to play, and whether it would be heard by the club. */
  cue?: { plan: CuePlan; blocked: boolean };
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const fader = useRef<HTMLDivElement>(null);
  const bass = useRef<HTMLSpanElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const startFrom = useRef<HTMLDivElement>(null);
  // Jog wheel: the start point while it's being turned, and whether this deck's mix has begun.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  // A scratch in progress: whether a cue should resume after it.
  const scratch = useRef<{ resumeCue: boolean } | null>(null);
  const scratchAt = useSession((s) => s.scratch);
  const scratchEnd = useSession((s) => s.scratchEnd);
  const cueHead = useRef<HTMLSpanElement>(null);
  const cueTag = `cue:${deck}`;
  const lockedRef = useRef(false);
  const cueing = usePreview((s) => s.playing === cueTag);
  const cueLoading = usePreview((s) => s.loading);
  const playPreview = usePreview((s) => s.play);
  const stopPreview = usePreview((s) => s.stop);
  const getFile = useLibrary((s) => s.getFile);
  // A different song on this deck, or the deck going on air (Play): its cue is over.
  useEffect(() => {
    return () => {
      if (usePreview.getState().playing === cueTag) usePreview.getState().stop();
    };
  }, [track?.id, role, cueTag]);
  const a = track?.analysis ?? null;

  useBoothFrame((snap) => {
    const view = snap?.decks[deck] ?? null;
    let label = ROLE_LABEL[role];
    if (snap?.mix && snap.now >= snap.mix.start) {
      if (role === "incoming") label = snap.layering ? "Layered" : "Mixing in";
      if (role === "live" && !snap.layering) label = "Mixing out";
    }
    setText(badge.current, label);
    // Once this deck's mix is (about to be) under way, its track and start can't change.
    const locked = role === "incoming" && !!snap?.mix && snap.now >= snap.mix.start - SCHEDULE_MARGIN;
    if (locked !== lockedRef.current) {
      lockedRef.current = locked;
      setLocked(locked);
    }
    // Its mix is starting: the song is about to be on the club speakers, so its cue stops.
    if (locked && usePreview.getState().playing === cueTag) usePreview.getState().stop();
    // And the jog wheel goes away mid-scratch: let the scratch go too.
    if (locked && scratch.current) {
      scratch.current = null;
      scratchEnd();
    }
    if (choose.current) choose.current.style.display = locked ? "none" : "";
    if (startFrom.current) startFrom.current.style.display = locked ? "none" : "";
    // Cue playhead (the preview player's position, not the deck's).
    const preview = usePreview.getState();
    const pos = preview.playing === cueTag ? (preview.position() ?? 0) : null;
    setText(cueHead.current, pos === null ? "" : `cue ${formatTime(pos)}.${Math.floor((pos % 1) * 10)}`);
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

  // On a loaded or cued deck (never on air, nor once its mix has begun) the jog wheel sets the start point.
  const chosenStart =
    entry && a ? (entry.choice.kind === "bar" ? a.firstBeat + entry.choice.bar * barSeconds(a) : entry.startAt) : 0;
  const jog: JogScrub | undefined =
    entry && track && a && !locked
      ? {
          position: chosenStart,
          duration: a.duration,
          beat: barSeconds(a) / 4,
          label: `Start point, Deck ${DECK_LETTERS[deck]}`,
          valueText: (pos) => barLabel(beatBar(a, pos)),
          onMove: (pos, step) => {
            setScrubbing(pos);
            // The scratch is heard on the club speakers: a drag follows the wheel, a key / scroll step
            // plays a short blip. A playing preview pauses while scratching.
            if (!scratch.current) {
              const preview = usePreview.getState();
              scratch.current = { resumeCue: preview.playing === cueTag };
              if (preview.playing) preview.stop();
            }
            scratchAt(track, pos, step);
          },
          onCommit: (pos) => {
            const bar = beatBar(a, pos);
            const resumeCue = scratch.current?.resumeCue ?? usePreview.getState().playing === cueTag;
            scratch.current = null;
            scratchEnd();
            setScrubbing(null);
            entry.set({ kind: "bar", bar });
            // A cue that was playing carries on from the new start.
            if (resumeCue) {
              const from = a.firstBeat + bar * barSeconds(a);
              void playPreview(cueTag, async (p) => p.playFrom(await getFile(track), from, { length: 60 }));
            }
          },
        }
      : undefined;

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
          <JogWheel deck={deck} track={track} color={color} scrub={jog}>
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
                {barLabel(entry.choice.bar)}
              </span>
            )}
            {cue && (
              <div className="mt-1 flex w-full flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className="btn"
                  disabled={cue.blocked || (cueLoading && !cueing)}
                  title={cue.blocked ? "Choose a separate preview output (Library → Audio outputs) to cue during a set" : "Listen on the preview output"}
                  onClick={() =>
                    cueing
                      ? stopPreview()
                      : playPreview(cueTag, async (p) =>
                          p.playFrom(
                            await getFile(track),
                            cue.plan.from,
                            cue.plan.jump ? { jump: { ...cue.plan.jump, after: 30 } } : { length: 60 },
                          ),
                        )
                  }
                >
                  {cueing ? "■ Stop cue" : "🎧 Cue"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!cueing}
                  onClick={() => {
                    const pos = usePreview.getState().position();
                    if (pos !== null && track.analysis) entry.set({ kind: "bar", bar: barAt(track.analysis, pos) });
                  }}
                >
                  Set start here
                </button>
                <span ref={cueHead} className="font-mono text-xs text-muted" />
              </div>
            )}
          </div>
        )}
      </div>

      <TrackOverview
        deck={deck}
        track={track}
        color={color}
        live={role === "live"}
        startAt={scrubbing ?? entry?.startAt}
        onPickBar={entry ? (bar) => entry.set({ kind: "bar", bar }) : undefined}
      />
    </section>
  );
}
