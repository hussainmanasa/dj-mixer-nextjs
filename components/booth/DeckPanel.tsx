"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_TEMPO } from "@/lib/dj/autodj";
import { barLabel, beatBar, entryOptions } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { useLibrary } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";
import { MAX_SAVED_LOOPS, type EntryChoice, type Track } from "@/lib/types";
import { formatTime, setText, useBoothFrame } from "./frame";
import { JogWheel, type JogScrub } from "./JogWheel";
import { DECK_LETTERS, LABEL, PANEL, SMALL_BUTTON, padStyle } from "./theme";
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

/** Pad modes, like the controller's: the 8 pads are cue pads, beat loops or the song's saved loops. */
type PadMode = "hotcue" | "beatloop" | "savedloop";
const PAD_MODES: { mode: PadMode; label: string; name: string }[] = [
  { mode: "hotcue", label: "Hot cue", name: "Hot cue pads" },
  { mode: "beatloop", label: "Beat loop", name: "Beat loop pads" },
  { mode: "savedloop", label: "Saved", name: "Saved loop pads" },
];
const LOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const LOOP_LABEL: Record<number, string> = { 0.25: "¼", 0.5: "½" };
const LOOP_COLOR = "#fbbf24";

/**
 * One deck, laid out like a DDJ-FLX4 deck: the loop section and BEAT SYNC on
 * top, a small display (song, BPM, time, overview, Start from), the jog wheel
 * with the tempo slider beside it, and CUE / ▶ ⏸ beside the pad-mode buttons
 * and 8 performance pads at the bottom. Every control is always there and works
 * whenever the deck has a song — nothing is locked while a mix runs. Every
 * press goes through the auto-DJ, which keeps the decks in time.
 */
export function DeckPanel({
  deck,
  role,
  track,
  color,
  onEject,
  keyLock = false,
  entry,
  transport,
  onStart,
  strip,
}: {
  deck: number;
  role: DeckRole;
  track: Track | null;
  color: string;
  /** Take a song loaded before Play off the deck. */
  onEject?: () => void;
  /** Key-lock is running: tempo changes don't change pitch. */
  keyLock?: boolean;
  /** Cued or loaded deck: where the song comes in ("Start from"), and how to change it. */
  entry?: { choice: EntryChoice; startAt: number; set: (choice: EntryChoice) => void };
  /**
   * During a set, on the on-air and cued decks: ⏸ / ▶, CUE and the tempo slider. `setPaused`: nothing is
   * playing. `tempo`: the cued song's tempo after its mix (null = its own).
   */
  transport?: { setPaused: boolean; thisPaused: boolean; tempo?: number | null; cuePoint?: number | null };
  /** Before the set, on a loaded deck: ▶ starts the set with this deck's song. */
  onStart?: () => void;
  /** Extra controls in the deck's display (decks C / D carry their own LOAD and 🎧 CUE: the mixer has two channels). */
  strip?: ReactNode;
}) {
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  // Jog wheel: the start point while it's being turned.
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  // A scratch in progress: whether a cue should resume after it.
  const scratch = useRef<{ resumeCue: boolean } | null>(null);
  const scratchAt = useSession((s) => s.scratch);
  const scratchEnd = useSession((s) => s.scratchEnd);
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
  const playPreview = usePreview((s) => s.play);
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
  // Where the deck is now (track seconds): a playing or paused song's spot, else the cue / start point.
  const spot = () => {
    if (playingDeck) return useSession.getState().snapshot()?.decks[deck]?.position ?? null;
    const preview = usePreview.getState();
    return preview.playing === cueTag ? preview.position() : (scrubbing ?? chosenStart);
  };
  return (
    <section
      aria-label={`Deck ${letter}`}
      className={`${PANEL} flex min-w-0 flex-col gap-3 p-4 transition-opacity ${active ? "opacity-100" : "opacity-70"}`}
      style={role === "live" ? { borderColor: `color-mix(in srgb, ${color} 55%, #2a2a31)` } : undefined}
    >
      {/* Top: the loop section, and BEAT SYNC above the tempo slider. */}
      <div className="flex items-start justify-between gap-2">
        <LoopSection deck={deck} track={liveTrack ?? null} disabled={loopOff} stopped={(role === "incoming" && !mixing) || !!transport?.thisPaused} spot={spot} />
        <button
          ref={syncButton}
          type="button"
          data-on="false"
          className={`${SMALL_BUTTON} h-9 data-[on=true]:border-[var(--sync)] data-[on=true]:bg-[var(--sync)] data-[on=true]:text-black`}
          style={{ "--sync": color } as React.CSSProperties}
          // Nothing to sync to, or more than 8% apart (half / double tempo counts).
          disabled={syncOff}
          onClick={() => syncDeck(deck)}
          aria-label={`Sync Deck ${letter}`}
          title={role === "live" ? "Set this song's BPM to the cued song's" : "Set this song's BPM to the song on air's"}
        >
          Beat sync
        </button>
      </div>

      {/* The deck's display: like the software screen above a controller. */}
      <div className="rounded-xl border border-[#26262c] bg-[#0b0b0e] p-3">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-[#c8c8d0]">Deck {letter}</h3>
            <span
              ref={badge}
              className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={role === "live" || role === "loaded" ? { background: color, color: "#07070b" } : { background: "#1f1f25", color: "#9a9aa6" }}
            >
              {ROLE_LABEL[role]}
            </span>
            <span
              className="rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ borderColor: color, color, visibility: keyLock ? "visible" : "hidden" }}
              title="Key lock: the track keeps its original key while its tempo is matched"
              aria-hidden={!keyLock}
            >
              Key lock
            </span>
          </div>
          <button
            type="button"
            onClick={onEject}
            className="rounded px-1.5 text-sm text-[#9a9aa6] hover:text-foreground disabled:opacity-30"
            disabled={!onEject}
            aria-label={`Eject Deck ${letter}`}
            title="Take the song off the deck"
          >
            ⏏
          </button>
        </header>
        <div className="mt-1.5 min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{track?.title ?? "—"}</p>
          <p className="truncate text-sm text-muted">{track ? track.artist || "Unknown artist" : "Waiting for a track"}</p>
        </div>
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
        <div className="mt-2">
          <TrackOverview
            deck={deck}
            track={track}
            color={color}
            live={role === "live"}
            startAt={scrubbing ?? (playingDeck ? (transport?.cuePoint ?? undefined) : entry?.startAt)}
            hotCues={liveTrack?.hotCues}
            onPickBar={entry ? (bar) => entry.set({ kind: "bar", bar }) : undefined}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Start from" aria-disabled={entryOff}>
          <span className={`mr-1 ${LABEL}`}>Start from</span>
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
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={on ? { borderColor: color, background: color, color: "#07070b" } : { borderColor: "#2e2e36", color: "#9a9aa6" }}
              >
                {ENTRY_LABEL[kind]}
              </button>
            );
          })}
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: color, color: "#07070b", visibility: entry?.choice.kind === "bar" ? "visible" : "hidden" }}
          >
            {entry?.choice.kind === "bar" ? barLabel(entry.choice.bar) : "Bar 1.1"}
          </span>
        </div>
        {strip}
      </div>

      {/* The jog wheel, with the tempo slider on its right like the controller's. */}
      <div className="flex flex-1 items-stretch gap-3">
        <div className="mx-auto w-full max-w-[15rem] flex-1 self-center">
          <JogWheel deck={deck} track={track} color={color} scrub={jog} art={art} />
        </div>
        <div className="flex w-12 flex-col items-center gap-1">
          <span className={LABEL}>Tempo</span>
          <span className="text-[10px] font-bold text-[#9a9aa6]" aria-hidden>
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
            disabled={tempoOff}
            onChange={(e) => setDeckTempo(deck, 1 + Number(e.target.value) / 100)}
            onDoubleClick={() => setDeckTempo(deck, 1)}
            className="w-full flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            style={{ writingMode: "vertical-lr", direction: "rtl", accentColor: color }}
          />
          <span className="text-[10px] font-bold text-[#9a9aa6]" aria-hidden>
            −{MAX_TEMPO * 100}
          </span>
          <button
            type="button"
            className="rounded border border-[#34343c] px-1.5 py-0.5 font-mono text-[10px] text-[#9a9aa6] hover:text-foreground disabled:opacity-40"
            disabled={tempoOff}
            onClick={() => setDeckTempo(deck, 1)}
            aria-label={`Reset tempo, Deck ${letter}`}
            title="Back to the song's own tempo"
          >
            <span ref={tempoValue}>0.0%</span>
          </button>
        </div>
      </div>

      {/* Bottom: CUE and ▶ / ⏸ on the left, the pad modes and 8 pads on the right. */}
      <div className="flex items-end gap-3">
        <Transport
          deck={deck}
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
        <PadSection
          deck={deck}
          track={liveTrack && a ? liveTrack : null}
          color={color}
          padsOff={!liveTrack || !a || !active || (playingDeck ? !transport : !entry)}
          loopOff={loopOff}
          stopped={(role === "incoming" && !mixing) || !!transport?.thisPaused}
          spot={spot}
          // A song playing (or stopped mid-song): it jumps there on the beat (stopped: moves there). Else: its start point.
          onGo={(pos) => (playingDeck ? jumpTo(deck, pos) : a && entry?.set({ kind: "bar", bar: beatBar(a, pos) }))}
        />
      </div>
    </section>
  );
}

/**
 * A deck's transport, like the controller's two round buttons: CUE above
 * ▶ / ⏸. ▶ plays the deck from where it stands (the cued song: together with
 * the song on air, beat-matched when they can be); ⏸ stops it there and changes
 * nothing else. CUE: playing, it goes back to the cue point and stops; stopped
 * elsewhere, that spot becomes the cue point; stopped at the cue point, it plays
 * while held (▶ meanwhile keeps it playing).
 */
function Transport({
  deck,
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
  const round = "flex h-16 w-16 flex-col items-center justify-center rounded-full border-[3px] font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35";
  const amber = "#f59e0b";
  const green = "#22c55e";
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <button
        type="button"
        className={round}
        disabled={!canCue}
        aria-label={`Cue Deck ${letter}`}
        aria-pressed={held}
        title={
          !inSet
            ? "CUE works once the set is playing (🎧 CUE in the mixer previews on the headphones)"
            : playing
              ? "Back to the cue point, stopped there"
              : cued
                ? "Hold to play the cued song from its start point; let go and it waits there"
                : "Sets the cue point here — at the cue point, hold to play from it"
        }
        style={
          held
            ? { borderColor: amber, background: amber, color: "#07070b", boxShadow: `0 0 18px ${amber}` }
            : { borderColor: amber, background: "#141418", color: amber, boxShadow: "inset 0 2px 3px rgba(255,255,255,0.06), 0 3px 0 #08080a" }
        }
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
        <span className="text-[15px] tracking-wider">CUE</span>
      </button>
      <button
        type="button"
        className={round}
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
        style={
          pause
            ? { borderColor: green, background: `color-mix(in srgb, ${green} 25%, #141418)`, color: "#f4f4f5", boxShadow: `0 0 18px color-mix(in srgb, ${green} 55%, transparent)` }
            : { borderColor: canPlay ? green : "#34343c", background: "#141418", color: canPlay ? green : "#8a8a96", boxShadow: "inset 0 2px 3px rgba(255,255,255,0.06), 0 3px 0 #08080a" }
        }
      >
        <span className="flex flex-col items-center leading-none">
          <span className="text-lg">{pause ? "⏸" : "▶"}</span> <span className="text-[10px] uppercase tracking-wider">{pause ? "Pause" : "Play"}</span>
        </span>
      </button>
    </div>
  );
}

/**
 * The loop section along the top of the deck, like the controller's: IN and OUT set a loop by hand (on the
 * beat), 4 BEAT starts a 4-beat loop (EXIT lets it go), ½ and 2× halve or double the loop playing. On a
 * stopped song the loop is armed (dashed): it loops from there once ▶ plays it.
 */
function LoopSection({
  deck,
  track,
  disabled,
  stopped,
  spot,
}: {
  deck: number;
  track: Track | null;
  disabled: boolean;
  stopped: boolean;
  spot: () => number | null;
}) {
  const loop = useSession((s) => s.status.loops.find((l) => l.deck === deck) ?? null);
  const setLoop = useSession((s) => s.loop);
  const savedLoop = useSession((s) => s.savedLoop);
  const exitLoop = useSession((s) => s.exitLoop);
  const letter = DECK_LETTERS[deck];
  const a = track?.analysis;
  // IN pressed: the loop's start (track seconds, on the beat) until OUT.
  const [loopIn, setLoopIn] = useState<{ trackId: string; at: number } | null>(null);
  const inAt = loopIn && track && loopIn.trackId === track.id ? loopIn.at : null;
  const onBeat = (pos: number) => {
    const beat = 60 / a!.bpm;
    return a!.firstBeat + Math.round((pos - a!.firstBeat) / beat) * beat;
  };
  const length = loop ? loop.end - loop.start : 0;
  const resize = (factor: number) => {
    if (!loop || !a) return;
    if (loop.beats !== null) {
      const beats = Math.max(0.125, Math.min(64, loop.beats * factor));
      if (beats !== loop.beats) setLoop(deck, beats);
    } else {
      savedLoop(deck, loop.start, Math.min(a.duration - 0.05, loop.start + length * factor));
    }
  };
  const lit = (on: boolean) =>
    on
      ? loop?.armed
        ? { borderColor: LOOP_COLOR, borderStyle: "dashed", color: LOOP_COLOR }
        : { borderColor: LOOP_COLOR, background: LOOP_COLOR, color: "#07070b" }
      : undefined;
  return (
    <div role="group" aria-label={`Loop, Deck ${letter}`} className="flex flex-col gap-1">
      <span className={LABEL}>
        Loop{stopped && <span className="ml-1 normal-case tracking-normal">(starts with ▶)</span>}
      </span>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={disabled || !a}
          aria-pressed={inAt !== null}
          aria-label={`Loop in, Deck ${letter}`}
          title="Loop in: the loop starts on this beat (then press OUT)"
          style={inAt !== null ? { borderColor: LOOP_COLOR, color: LOOP_COLOR } : undefined}
          onClick={() => {
            const pos = spot();
            if (pos !== null && track && a) setLoopIn({ trackId: track.id, at: onBeat(pos) });
          }}
        >
          In
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={disabled || inAt === null}
          aria-label={`Loop out, Deck ${letter}`}
          title="Loop out: loop from IN to this beat"
          onClick={() => {
            const pos = spot();
            if (pos === null || inAt === null || !a) return;
            const out = Math.max(onBeat(pos), inAt + 60 / a.bpm);
            savedLoop(deck, inAt, Math.min(a.duration - 0.05, out));
            setLoopIn(null);
          }}
        >
          Out
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!loop && disabled}
          aria-label={loop ? (loop.armed ? `Don't loop, Deck ${letter}` : `Exit loop, Deck ${letter}`) : `4-beat loop, Deck ${letter}`}
          title={loop ? "Let the loop go; the song plays on from there" : "Loop 4 beats from this beat"}
          style={lit(!!loop)}
          onClick={() => (loop ? exitLoop(deck) : setLoop(deck, 4))}
        >
          {loop ? (loop.armed ? "Don't loop" : "Exit") : "4 Beat"}
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!loop}
          aria-label={`Halve loop, Deck ${letter}`}
          title="Halve the loop"
          onClick={() => resize(0.5)}
        >
          ◀ ½
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          disabled={!loop}
          aria-label={`Double loop, Deck ${letter}`}
          title="Double the loop"
          onClick={() => resize(2)}
        >
          2× ▶
        </button>
      </div>
    </div>
  );
}

/**
 * The pad modes and the 8 performance pads: HOT CUE (cue pads A–H), BEAT LOOP
 * (¼ to 32 beats, from the beat it's on — pressed again, it lets go) and SAVED
 * LOOP (the song's loops from the track editor). The mode row keeps its place;
 * Clear (hot cues) sits at its end.
 */
function PadSection({
  deck,
  track,
  color,
  padsOff,
  loopOff,
  stopped,
  spot,
  onGo,
}: {
  deck: number;
  track: Track | null;
  color: string;
  padsOff: boolean;
  loopOff: boolean;
  stopped: boolean;
  spot: () => number | null;
  onGo: (position: number) => void;
}) {
  const [mode, setMode] = useState<PadMode>("hotcue");
  const [clearing, setClearing] = useState(false);
  const loop = useSession((s) => s.status.loops.find((l) => l.deck === deck) ?? null);
  const setLoop = useSession((s) => s.loop);
  const savedLoop = useSession((s) => s.savedLoop);
  const letter = DECK_LETTERS[deck];
  const a = track?.analysis;
  const lit = (on: boolean) =>
    on
      ? loop?.armed
        ? { ...padStyle(null), borderColor: LOOP_COLOR, borderStyle: "dashed", color: LOOP_COLOR }
        : padStyle(LOOP_COLOR)
      : padStyle(null);
  return (
    <div className="min-w-0 flex-1" role="group" aria-label={`Pads, Deck ${letter}`}>
      <div className="mb-1.5 flex items-center gap-1">
        {PAD_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={`${SMALL_BUTTON} flex-1 truncate px-1`}
            aria-pressed={mode === m.mode}
            aria-label={`${m.name}, Deck ${letter}`}
            onClick={() => {
              setMode(m.mode);
              setClearing(false);
            }}
            style={mode === m.mode ? { borderColor: color, color } : undefined}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          className={`${SMALL_BUTTON} px-1.5`}
          style={{ visibility: mode === "hotcue" ? "visible" : "hidden", ...(clearing ? { borderColor: "var(--bad)", color: "var(--bad)" } : {}) }}
          aria-hidden={mode !== "hotcue"}
          tabIndex={mode === "hotcue" ? 0 : -1}
          aria-pressed={clearing}
          disabled={!track || !track.hotCues?.some((p) => p !== null)}
          onClick={() => setClearing((c) => !c)}
          title="Then tap a pad to empty it (or Shift-click a pad)"
        >
          {clearing ? "Tap pad" : "Clear"}
        </button>
      </div>
      {mode === "hotcue" && (
        <CuePads deck={deck} track={track} color={color} disabled={padsOff} clearing={clearing} onCleared={() => setClearing(false)} spot={spot} onGo={onGo} />
      )}
      {mode === "beatloop" && (
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Beat loop pads, Deck ${letter}`}>
          {LOOP_BEATS.map((b) => {
            const on = loop?.beats === b;
            return (
              <button
                key={b}
                type="button"
                disabled={loopOff && !on}
                aria-pressed={on}
                aria-label={`Loop ${b} beat${b === 1 ? "" : "s"}, Deck ${letter}`}
                title={on ? "Let the loop go" : stopped ? `Loop ${b} beat${b === 1 ? "" : "s"} from where it stands` : `Loop ${b} beat${b === 1 ? "" : "s"} from this beat`}
                onClick={() => setLoop(deck, b)}
                className="flex h-12 items-center justify-center rounded-md border font-mono text-sm font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={lit(on)}
              >
                {LOOP_LABEL[b] ?? b}
              </button>
            );
          })}
        </div>
      )}
      {mode === "savedloop" && (
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Saved loops, Deck ${letter}`}>
          {Array.from({ length: 8 }, (_, i) => {
            const l = i < MAX_SAVED_LOOPS ? track?.savedLoops?.[i] : undefined;
            if (i >= MAX_SAVED_LOOPS) return <span key={i} aria-hidden className="h-12 rounded-md border" style={padStyle(null)} />;
            const on = !!l && !!loop && loop.beats === null && Math.abs(loop.start - l.start) < 0.01 && Math.abs(loop.end - l.end) < 0.01;
            const bars = l && a ? (l.end - l.start) / barSeconds(a) : 0;
            return (
              <button
                key={i}
                type="button"
                disabled={!l || !a || (loopOff && !on)}
                aria-pressed={on}
                aria-label={l && a ? `Saved loop ${i + 1}, ${barLabel(beatBar(a, l.start))}, Deck ${letter}` : `Saved loop ${i + 1} (none), Deck ${letter}`}
                title={l && a ? (on ? "Let the loop go" : `Loop ${barLabel(beatBar(a, l.start))}, ${Math.round(bars * 4) / 4} bars`) : "Save loops in the track editor"}
                onClick={() => l && savedLoop(deck, l.start, l.end)}
                className="flex h-12 flex-col items-center justify-center rounded-md border px-1 text-xs font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={lit(on)}
              >
                <span>L{i + 1}</span>
                <span className="font-mono text-[10px] font-normal leading-none">{l && a ? `${Math.round(bars * 4) / 4} bar${bars === 1 ? "" : "s"}` : "—"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
