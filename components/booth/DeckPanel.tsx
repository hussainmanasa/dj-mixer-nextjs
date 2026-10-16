"use client";

import { useEffect, useRef, useState } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { MAX_TEMPO } from "@/lib/dj/autodj";
import { barAt, barLabel, beatBar, entryOptions, type CuePlan } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { useLibrary } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";
import { MAX_SAVED_LOOPS, type EntryChoice, type Track } from "@/lib/types";
import { formatTime, setText, useBoothFrame } from "./frame";
import { JogWheel, type JogScrub } from "./JogWheel";
import { DECK_LETTERS } from "./theme";
import { TrackOverview } from "./TrackOverview";
import { useArtwork } from "./useArtwork";
import { CuePads } from "./CuePads";
import { syncRatio } from "@/lib/dj/selector";

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
 * One deck: jog wheel, tempo, fader and bass meters, transport (CUE, ▶ / ⏸),
 * loops, cue pads and the track overview. Every control is always there and
 * works whenever the deck has a song — nothing is locked while a mix runs.
 * Every press goes through the auto-DJ, which keeps the decks in time.
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
  transport,
  onStart,
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
  /**
   * During a set, on the on-air and cued decks: ⏸ / ▶, CUE and the tempo slider. `setPaused`: nothing is
   * playing. `tempo`: the cued song's tempo after its mix (null = its own).
   */
  transport?: { setPaused: boolean; thisPaused: boolean; tempo?: number | null; cuePoint?: number | null };
  /** Before the set, on a loaded deck: ▶ starts the set with this deck's song. */
  onStart?: () => void;
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const fader = useRef<HTMLDivElement>(null);
  const bass = useRef<HTMLSpanElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const startFrom = useRef<HTMLDivElement>(null);
  // Jog wheel: the start point while it's being turned.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // A scratch in progress: whether a cue should resume after it.
  const scratch = useRef<{ resumeCue: boolean } | null>(null);
  const scratchAt = useSession((s) => s.scratch);
  const scratchEnd = useSession((s) => s.scratchEnd);
  const cueHead = useRef<HTMLSpanElement>(null);
  const cueTag = `cue:${deck}`;
  // The cued deck's song is sounding (its mix, or playing along): it is a playing deck now, not a cued one.
  const [mixing, setMixing] = useState(false);
  const mixingRef = useRef(false);
  const pauseDeck = useSession((s) => s.pauseDeck);
  const playDeck = useSession((s) => s.playDeck);
  const cueDeck = useSession((s) => s.cueDeck);
  const grabDeck = useSession((s) => s.grabDeck);
  const releaseDeck = useSession((s) => s.releaseDeck);
  const holding = useSession((s) => s.status.holding);
  const syncDeck = useSession((s) => s.syncDeck);
  const jumpTo = useSession((s) => s.jumpTo);
  const syncButton = useRef<HTMLButtonElement>(null);
  // The other deck's song for Sync: the cued one for the song on air, and the other way round.
  const otherBpm = useSession((s) =>
    role === "live" && s.status.next?.track.analysis
      ? s.status.next.track.analysis.bpm * (s.status.next.tempo ?? 1)
      : role === "incoming" && s.status.now
        ? s.status.now.bpm
        : null,
  );
  // The song as the library has it now (cue pads change while it plays; `track` is the deck's copy).
  const liveTrack = useLibrary((s) => (track ? s.tracks[track.id] : undefined)) ?? track;
  const spinBack = useSession((s) => s.spinBack);
  const setDeckTempo = useSession((s) => s.setDeckTempo);
  const tempoInput = useRef<HTMLInputElement>(null);
  const tempoValue = useRef<HTMLSpanElement>(null);
  const art = useArtwork(track);
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
      if (role === "incoming") label = snap.layering ? (useSession.getState().status.next?.together ? "Playing along" : "Layered") : "Mixing in";
      if (role === "live" && !snap.layering) label = "Mixing out";
    }
    if (transport?.thisPaused) label = holding === deck ? "Scratch" : "Paused";
    setText(badge.current, label);
    const nowMixing = role === "incoming" && !!snap?.mix && snap.now >= snap.mix.start;
    if (nowMixing !== mixingRef.current) {
      mixingRef.current = nowMixing;
      setMixing(nowMixing);
    }
    // The cued song is on the club speakers now: its headphone preview stops, and a start-point scratch ends.
    if (nowMixing && usePreview.getState().playing === cueTag) usePreview.getState().stop();
    if (nowMixing && scratch.current) {
      scratch.current = null;
      scratchEnd();
    }
    // Cue playhead (the preview player's position, not the deck's).
    const preview = usePreview.getState();
    const pos = preview.playing === cueTag ? (preview.position() ?? 0) : null;
    setText(cueHead.current, pos === null ? "" : `cue ${formatTime(pos)}.${Math.floor((pos % 1) * 10)}`);
    const rate = view?.rate ?? 1;
    setText(bpm.current, a ? (a.bpm * rate).toFixed(1) : "—");
    const pct = (rate - 1) * 100;
    // Tempo change from the track's own BPM (beat-matching). With key-lock on, pitch stays put.
    setText(tempo.current, view && Math.abs(pct) >= 0.05 ? `tempo ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "BPM");
    // The tempo slider shows the deck's tempo (the cued song before its mix: the tempo it will settle at),
    // except while staff are moving it.
    const shown = role === "incoming" && !nowMixing ? (transport?.tempo ?? 1) : rate;
    const shownPct = (shown - 1) * 100;
    const input = tempoInput.current;
    if (input && document.activeElement !== input) input.value = shownPct.toFixed(1);
    setText(tempoValue.current, `${shownPct > 0 ? "+" : ""}${shownPct.toFixed(1)}%`);
    // Sync lights up while both decks are at the same BPM (or half / double).
    const st = useSession.getState().status;
    const otherBpm =
      role === "live" && st.next?.track.analysis
        ? st.next.track.analysis.bpm * (st.next.tempo ?? 1)
        : role === "incoming" && st.now?.track.analysis
          ? st.now.track.analysis.bpm * (snap?.decks[st.now.deck]?.rate ?? 1)
          : null;
    const myBpm = a ? a.bpm * shown : null;
    const matched = otherBpm !== null && myBpm !== null && [1, 2, 0.5].some((m) => Math.abs(myBpm * m - otherBpm) < 0.06);
    syncButton.current?.setAttribute("data-on", String(matched));
    setText(time.current, a ? `${formatTime(view?.position ?? 0)} / −${formatTime(a.duration - (view?.position ?? 0))}` : "");
    if (fader.current) fader.current.style.transform = `scaleY(${view ? view.fader : 0})`;
    if (bass.current) {
      const on = view ? Math.max(0, Math.min(1, 1 - view.bassDb / EQ_KILL_DB)) : 0;
      bass.current.style.opacity = String(0.2 + on * 0.8);
    }
  });

  // On a loaded or cued deck the jog wheel sets the start point.
  const chosenStart =
    entry && a ? (entry.choice.kind === "bar" ? a.firstBeat + entry.choice.bar * barSeconds(a) : entry.startAt) : 0;
  // A deck whose song is playing or stopped mid-song (on air, mixing in, playing along): the wheel holds and
  // moves the song like a record.
  const playingDeck = role === "live" || (role === "incoming" && mixing);
  const liveJog: JogScrub | undefined =
    playingDeck && transport && track && a
      ? {
          position: 0,
          duration: a.duration,
          beat: barSeconds(a) / 4,
          label: `Song position, Deck ${DECK_LETTERS[deck]}`,
          valueText: (pos) => `${barLabel(beatBar(a, pos))} · ${formatTime(pos)}`,
          live: {
            position: () => useSession.getState().snapshot()?.decks[deck]?.position ?? 0,
            onGrab: () => grabDeck(deck),
            onFling: (pos) => {
              scratchEnd();
              spinBack(deck, pos);
            },
          },
          // Turning it scratches on the club speakers — playing or paused, like a record under the hand.
          onMove: (pos, step) => scratchAt(track, pos, step),
          onCommit: (pos) => {
            scratchEnd();
            releaseDeck(deck, pos);
          },
        }
      : undefined;
  const jog: JogScrub | undefined =
    liveJog ??
    (entry && track && a && !playingDeck
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
      : undefined);

  const active = role === "live" || role === "incoming" || role === "loaded";
  // Every control is always there (so nothing jumps when a deck changes role) and works whenever the deck has
  // a song during the set — nothing waits for a mix.
  const inSet = !!transport;
  const onDeck = role === "live" || role === "incoming";
  const tempoOff = !(inSet && onDeck && a);
  const syncOff = tempoOff || !a || otherBpm === null || syncRatio(otherBpm, a.bpm, true) === null;
  const loopOff = !(inSet && onDeck && liveTrack && a);
  const entryOff = !entry || !track || playingDeck;
  const available = track ? entryOptions(track) : [];
  const letter = DECK_LETTERS[deck];
  return (
    <section
      aria-label={`Deck ${letter}`}
      className={`flex min-w-0 flex-col gap-4 rounded-3xl border bg-surface/80 p-5 backdrop-blur transition-opacity ${
        active ? "opacity-100" : "opacity-60"
      }`}
      style={{ borderColor: role === "live" ? color : "var(--border)" }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted">Deck {letter}</h3>
          <span
            className="rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ borderColor: color, color, visibility: keyLock ? "visible" : "hidden" }}
            title="Key lock: the track keeps its original key while its tempo is matched"
            aria-hidden={!keyLock}
          >
            Key lock
          </span>
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
          <JogWheel deck={deck} track={track} color={color} scrub={jog} art={art} />
        </div>
        <div className="flex w-12 flex-col items-center gap-1">
          <span className="text-[10px] font-bold text-muted" aria-hidden>
            +{MAX_TEMPO * 100}
          </span>
          <input
            ref={tempoInput}
            type="range"
            min={-MAX_TEMPO * 100}
            max={MAX_TEMPO * 100}
            step={0.1}
            defaultValue={0}
            aria-label={`Tempo, Deck ${letter}`}
            title={
              role === "incoming"
                ? "Tempo this song settles at after its mix (it's beat-matched during the mix)"
                : "Tempo of the song on air; the auto-DJ re-times the next mix"
            }
            // Only during a set, on the on-air and cued decks, and not while the auto-DJ has the tempo (a mix).
            disabled={tempoOff}
            onChange={(e) => setDeckTempo(deck, 1 + Number(e.target.value) / 100)}
            onDoubleClick={() => setDeckTempo(deck, 1)}
            className="w-full flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={{ writingMode: "vertical-lr", direction: "rtl", accentColor: color }}
          />
          <span className="text-[10px] font-bold text-muted" aria-hidden>
            −{MAX_TEMPO * 100}
          </span>
          <button
            type="button"
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-foreground disabled:opacity-40"
            disabled={tempoOff}
            onClick={() => setDeckTempo(deck, 1)}
            aria-label={`Reset tempo, Deck ${letter}`}
            title="Back to the song's own tempo"
          >
            <span ref={tempoValue}>0.0%</span>
          </button>
          <button
            ref={syncButton}
            type="button"
            data-on="false"
            className="rounded border border-border px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-muted hover:text-foreground disabled:opacity-40 data-[on=true]:border-[var(--sync)] data-[on=true]:bg-[var(--sync)] data-[on=true]:text-black"
            style={{ "--sync": color } as React.CSSProperties}
            // Nothing to sync to, or more than 8% apart (half / double tempo counts).
            disabled={syncOff}
            onClick={() => syncDeck(deck)}
            aria-label={`Sync Deck ${letter}`}
            title={role === "live" ? "Set this song's BPM to the cued song's" : "Set this song's BPM to the song on air's"}
          >
            Sync
          </button>
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
            <button ref={choose} type="button" onClick={onChoose?.open} className="btn" disabled={!onChoose}>
              {onChoose?.label ?? (track ? "Change track" : "Choose track")}
            </button>
            <button type="button" onClick={onEject} className="btn" disabled={!onEject} aria-label={`Eject Deck ${letter}`}>
              Eject
            </button>
          </div>
        </div>
        <Transport
          deck={deck}
          color={color}
          playing={!!transport && !!track && !transport.thisPaused && playingDeck}
          // During the set: any deck with a song. Before it: ▶ on a loaded deck starts the set with it.
          canPlay={(!!transport && !!track && onDeck) || (!transport && !!onStart && !!track)}
          canCue={!!transport && !!track && onDeck}
          cued={role === "incoming" && !mixing}
          inSet={inSet}
          onPlay={() => (transport ? playDeck(deck) : onStart?.())}
          onPause={() => pauseDeck(deck)}
          onCue={(down) => cueDeck(deck, down)}
        />
        <p className="mt-1 flex items-baseline justify-between gap-3 font-mono text-sm text-muted">
          <span>{track?.camelot ?? "key —"}</span>
          <span className="flex items-baseline gap-1.5">
            <span ref={bpm} className="text-lg font-bold text-foreground tabular-nums">
              —
            </span>
            <span ref={tempo} className="text-xs">
              BPM
            </span>
          </span>
          <span ref={time} className="tabular-nums" />
        </p>
        <div ref={startFrom} className="mt-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Start from" aria-disabled={entryOff}>
          <span className="mr-1 text-xs uppercase tracking-wider text-muted">Start from</span>
          {(["auto", "beginning", "dialogue", "hook", "drop"] as const).map((kind) => {
            const on = !!entry && entry.choice.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={entryOff || !available.includes(kind)}
                onClick={() => entry?.set({ kind } as EntryChoice)}
                className="rounded-full border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={on ? { borderColor: color, background: color, color: "#07070b" } : { borderColor: "var(--border)", color: "var(--muted)" }}
              >
                {ENTRY_LABEL[kind]}
              </button>
            );
          })}
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: color, color: "#07070b", visibility: entry?.choice.kind === "bar" ? "visible" : "hidden" }}
          >
            {entry?.choice.kind === "bar" ? barLabel(entry.choice.bar) : "Bar 1.1"}
          </span>
          <div className="mt-1 flex w-full flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="btn"
              disabled={!cue || !track || cue.blocked || (cueLoading && !cueing)}
              title={cue?.blocked ? "Choose a separate preview output (Library → Audio outputs) to listen during a set" : "Listen on the headphones (the preview output); the club hears nothing"}
              onClick={() =>
                cueing
                  ? stopPreview()
                  : cue &&
                    track &&
                    playPreview(cueTag, async (p) =>
                      p.playFrom(await getFile(track), cue.plan.from, cue.plan.jump ? { jump: { ...cue.plan.jump, after: 30 } } : { length: 60 }),
                    )
              }
            >
              {cueing ? "■ Stop listening" : "🎧 Listen"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!cueing || !entry}
              onClick={() => {
                const pos = usePreview.getState().position();
                if (pos !== null && track?.analysis) entry?.set({ kind: "bar", bar: barAt(track.analysis, pos) });
              }}
            >
              Set start here
            </button>
            <span ref={cueHead} className="font-mono text-xs text-muted" />
          </div>
        </div>
      </div>

      <LoopButtons deck={deck} track={liveTrack ?? null} stopped={(role === "incoming" && !mixing) || !!transport?.thisPaused} disabled={loopOff} />

      <CuePads
        deck={deck}
        track={liveTrack && a ? liveTrack : null}
        color={color}
        disabled={!liveTrack || !a || !active || (playingDeck ? !transport : !entry)}
        spot={() => {
          if (playingDeck) return useSession.getState().snapshot()?.decks[deck]?.position ?? null;
          const preview = usePreview.getState();
          return preview.playing === cueTag ? preview.position() : (scrubbing ?? chosenStart);
        }}
        // A song playing (or stopped mid-song): it jumps there on the beat (stopped: moves there). Else: its start point.
        onGo={(pos) => (playingDeck ? jumpTo(deck, pos) : a && entry?.set({ kind: "bar", bar: beatBar(a, pos) }))}
      />

      <TrackOverview
        deck={deck}
        track={track}
        color={color}
        live={role === "live"}
        startAt={scrubbing ?? (playingDeck ? (transport?.cuePoint ?? undefined) : entry?.startAt)}
        hotCues={liveTrack?.hotCues}
        onPickBar={entry ? (bar) => entry.set({ kind: "bar", bar }) : undefined}
      />
    </section>
  );
}

/**
 * A deck's transport, like a CDJ's: CUE and one Play / Pause button. ▶ plays
 * the deck from where it stands (the cued song: together with the song on air,
 * beat-matched when they can be); ⏸ stops it there and changes nothing else.
 * CUE: playing, it goes back to the cue point and stops; stopped elsewhere, that
 * spot becomes the cue point; stopped at the cue point, it plays while held
 * (▶ meanwhile keeps it playing).
 */
function Transport({
  deck,
  color,
  playing,
  canPlay,
  canCue,
  cued,
  inSet,
  onPlay,
  onPause,
  onCue,
}: {
  deck: number;
  color: string;
  playing: boolean;
  canPlay: boolean;
  canCue: boolean;
  /** The deck holds the cued song (not playing yet). */
  cued: boolean;
  inSet: boolean;
  onPlay: () => void;
  onPause: () => void;
  onCue: (down: boolean) => void;
}) {
  const letter = DECK_LETTERS[deck];
  const held = useSession((s) => s.status.cueHeld === deck);
  // A press is "down" until the pointer or key lets go (pointer capture keeps the release on the button).
  const down = useRef(false);
  // ▶ pressed while CUE is held: it acts on press (before CUE loses focus and lets go), not on the click after.
  const kept = useRef(false);
  // Holding CUE plays the deck, but the button still offers ▶ (it keeps it playing), like a CDJ.
  const pause = playing && !held;
  const press = () => {
    if (down.current) return;
    down.current = true;
    onCue(true);
  };
  const release = () => {
    if (!down.current) return;
    down.current = false;
    onCue(false);
  };
  return (
    <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
      <button
        type="button"
        className="btn h-14 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canCue}
        aria-label={`Cue Deck ${letter}`}
        aria-pressed={held}
        title={
          !inSet
            ? "CUE works once the set is playing (🎧 Listen previews on the headphones)"
            : playing
              ? "Back to the cue point, stopped there"
              : cued
                ? "Hold to play the cued song from its start point; let go and it waits there"
                : "Sets the cue point here — at the cue point, hold to play from it"
        }
        style={held ? { borderColor: color, background: color, color: "#07070b" } : { borderColor: "#fbbf24", color: "#fbbf24" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            press();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            release();
          }
        }}
        onBlur={release}
      >
        CUE
      </button>
      <button
        type="button"
        className="btn h-14 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canPlay}
        aria-label={`${pause ? "Pause" : "Play"} Deck ${letter}`}
        title={
          pause
            ? "Pause: it stops here; nothing else changes"
            : !inSet
              ? "Start the set with this song"
              : cued
                ? "Play it now, together with the song on air (beat-matched when they can be)"
                : "Play from here"
        }
        onPointerDown={() => {
          if (!held) return;
          kept.current = true;
          onPlay();
        }}
        onClick={() => {
          if (kept.current) kept.current = false;
          else if (pause) onPause();
          else onPlay();
        }}
        style={!pause && canPlay ? { borderColor: color, color } : undefined}
      >
        {pause ? "⏸ Pause" : "▶ Play"}
      </button>
    </div>
  );
}

const LOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16];
const LOOP_LABEL: Record<number, string> = { 0.25: "¼", 0.5: "½" };

/**
 * Loops on a deck: ¼ to 16 beats, and the song's saved loops. On a playing
 * song a loop starts on the beat it's in; on a stopped one (paused, or the cued
 * song) it is armed — it loops from there once ▶ plays it. The lit button is the
 * loop playing (dashed: armed); press it again, or Exit, to let the song carry on.
 */
function LoopButtons({ deck, track, stopped, disabled }: { deck: number; track: Track | null; stopped: boolean; disabled: boolean }) {
  const loop = useSession((s) => s.status.loops.find((l) => l.deck === deck) ?? null);
  const setLoop = useSession((s) => s.loop);
  const savedLoop = useSession((s) => s.savedLoop);
  const exitLoop = useSession((s) => s.exitLoop);
  const letter = DECK_LETTERS[deck];
  const a = track?.analysis;
  const style = (on: boolean) =>
    on
      ? loop?.armed
        ? { borderColor: "#fbbf24", borderStyle: "dashed", color: "#fbbf24", background: "color-mix(in srgb, #fbbf24 12%, var(--surface))" }
        : { borderColor: "#fbbf24", background: "#fbbf24", color: "#07070b" }
      : { borderColor: "var(--border)", background: "var(--surface-2)" };
  return (
    <div className="mt-3" role="group" aria-label={`Loop, Deck ${letter}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">
          Loop · beats{stopped && <span className="ml-1 normal-case tracking-normal">(starts with ▶)</span>}
        </span>
        <button
          type="button"
          className="rounded border border-warn px-2 py-0.5 text-[11px] font-semibold text-warn"
          onClick={() => exitLoop(deck)}
          style={{ visibility: loop ? "visible" : "hidden" }}
          tabIndex={loop ? 0 : -1}
          aria-hidden={!loop}
        >
          {loop?.armed ? "Don't loop" : "Exit loop"}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {LOOP_BEATS.map((b) => {
          const on = loop?.beats === b;
          return (
            <button
              key={b}
              type="button"
              disabled={disabled && !on}
              aria-pressed={on}
              aria-label={`Loop ${b} beat${b === 1 ? "" : "s"}, Deck ${letter}`}
              title={on ? "Let the loop go" : stopped ? `Loop ${b} beat${b === 1 ? "" : "s"} from where it stands` : `Loop ${b} beat${b === 1 ? "" : "s"} from this beat`}
              onClick={() => setLoop(deck, b)}
              className="h-10 rounded-lg border font-mono text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
              style={style(on)}
            >
              {LOOP_LABEL[b] ?? b}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5" aria-label={`Saved loops, Deck ${letter}`} role="group">
        {Array.from({ length: MAX_SAVED_LOOPS }, (_, i) => {
          const l = track?.savedLoops?.[i];
          const on = !!l && !!loop && loop.beats === null && Math.abs(loop.start - l.start) < 0.01 && Math.abs(loop.end - l.end) < 0.01;
          const bars = l && a ? (l.end - l.start) / barSeconds(a) : 0;
          return (
            <button
              key={i}
              type="button"
              disabled={!l || !a || (disabled && !on)}
              aria-pressed={on}
              aria-label={l && a ? `Saved loop ${i + 1}, ${barLabel(beatBar(a, l.start))}, Deck ${letter}` : `Saved loop ${i + 1} (none), Deck ${letter}`}
              title={l && a ? (on ? "Let the loop go" : `Loop ${barLabel(beatBar(a, l.start))}, ${Math.round(bars * 4) / 4} bars`) : "Save loops in the track editor"}
              onClick={() => l && savedLoop(deck, l.start, l.end)}
              className="h-9 truncate rounded-lg border px-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
              style={style(on)}
            >
              {l && a ? `L${i + 1} · ${Math.round(bars * 4) / 4} bar${bars === 1 ? "" : "s"}` : `L${i + 1}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
