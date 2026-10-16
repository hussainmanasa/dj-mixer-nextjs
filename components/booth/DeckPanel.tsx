"use client";

import { useEffect, useRef, useState } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { MAX_TEMPO, SCHEDULE_MARGIN } from "@/lib/dj/autodj";
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
 * One deck as the auto-DJ is running it: jog wheel, tempo, fader and bass
 * meters, and the track overview. Staff can choose the track for a deck that
 * isn't on air (`onChoose`; the auto-DJ mixes it in) and, during a set,
 * pause / play the on-air and cued decks (`transport`) — every press goes
 * through the auto-DJ, which keeps the mix in time.
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
   * During a set, on the on-air and cued decks: ⏸ / ▶ and the tempo slider. `setPaused`: the song on air is
   * paused. `tempo`: the cued song's tempo after its mix (null = its own).
   */
  transport?: { setPaused: boolean; thisPaused: boolean; tempo?: number | null };
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
  // This deck's mix is sounding (⏸ then stops one side of it), and the live song is in its dialogue.
  const [mixing, setMixing] = useState(false);
  const mixingRef = useRef(false);
  const [inDialogue, setInDialogue] = useState(false);
  const inDialogueRef = useRef(false);
  const pauseDeck = useSession((s) => s.pauseDeck);
  const playDeck = useSession((s) => s.playDeck);
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
  /** While the set is paused the club must stay silent: jog wheels move without a scratch. */
  const quiet = () => {
    const st = useSession.getState().status;
    return st.paused !== null && !st.holding;
  };
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
      if (role === "incoming") label = snap.layering ? "Layered" : "Mixing in";
      if (role === "live" && !snap.layering) label = "Mixing out";
    }
    if (transport?.thisPaused) label = holding ? "Scratch" : "Paused";
    setText(badge.current, label);
    const nowMixing = (role === "incoming" || role === "live") && !!snap?.mix && snap.now >= snap.mix.start;
    if (nowMixing !== mixingRef.current) {
      mixingRef.current = nowMixing;
      setMixing(nowMixing);
    }
    const dialogue = !!snap?.dropLocked;
    if (dialogue !== inDialogueRef.current) {
      inDialogueRef.current = dialogue;
      setInDialogue(dialogue);
    }
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

  // On a loaded or cued deck (never on air, nor once its mix has begun) the jog wheel sets the start point.
  const chosenStart =
    entry && a ? (entry.choice.kind === "bar" ? a.firstBeat + entry.choice.bar * barSeconds(a) : entry.startAt) : 0;
  // On air (playing or paused, not during a mix): the wheel holds and moves the song like a record.
  const liveJog: JogScrub | undefined =
    role === "live" && transport && track && a && !mixing
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
          onMove: (pos, step) => {
            if (!quiet()) scratchAt(track, pos, step);
          },
          onCommit: (pos) => {
            scratchEnd();
            releaseDeck(deck, pos);
          },
        }
      : undefined;
  const jog: JogScrub | undefined =
    liveJog ??
    (entry && track && a && !locked
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
            if (!quiet()) scratchAt(track, pos, step);
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
          <JogWheel deck={deck} track={track} color={color} scrub={jog} art={art} />
        </div>
        {transport && track && a && (role === "live" || role === "incoming") && (
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
              aria-label={`Tempo, Deck ${DECK_LETTERS[deck]}`}
              title={
                role === "incoming"
                  ? "Tempo this song settles at after its mix (it's beat-matched during the mix)"
                  : "Tempo of the song on air; the auto-DJ re-times the next mix"
              }
              // The cued song is coming in, or this one is mixing: the auto-DJ has the tempo then.
              disabled={mixing || (role === "incoming" && locked)}
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
              disabled={mixing || (role === "incoming" && locked)}
              onClick={() => setDeckTempo(deck, 1)}
              aria-label={`Reset tempo, Deck ${DECK_LETTERS[deck]}`}
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
              disabled={mixing || (role === "incoming" && locked) || otherBpm === null || syncRatio(otherBpm, a.bpm, true) === null}
              onClick={() => syncDeck(deck)}
              aria-label={`Sync Deck ${DECK_LETTERS[deck]}`}
              title={role === "live" ? "Set this song's BPM to the cued song's" : "Set this song's BPM to the song on air's"}
            >
              Sync
            </button>
          </div>
        )}
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
        {transport && track && (role === "live" || role === "incoming") && (
          <TransportButton
            deck={deck}
            role={role}
            color={color}
            paused={transport.thisPaused}
            setPaused={transport.setPaused}
            mixing={mixing}
            // The cued song is about to come in anyway, or the live song is still in its dialogue.
            busy={role === "incoming" && !mixing && !transport.setPaused && (locked || inDialogue)}
            onPause={() => pauseDeck(deck)}
            onPlay={() => playDeck(deck)}
          />
        )}
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

      {liveTrack && a && (role === "live" || role === "incoming" || role === "loaded") && (
        <CuePads
          deck={deck}
          track={liveTrack}
          color={color}
          disabled={role === "live" ? mixing || !transport : role === "incoming" ? locked || !entry : false}
          spot={() => {
            if (role === "live") return useSession.getState().snapshot()?.decks[deck]?.position ?? null;
            const preview = usePreview.getState();
            return preview.playing === cueTag ? preview.position() : (scrubbing ?? chosenStart);
          }}
          onGo={(pos) => (role === "live" ? jumpTo(deck, pos) : entry?.set({ kind: "bar", bar: beatBar(a, pos) }))}
        />
      )}

      <TrackOverview
        deck={deck}
        track={track}
        color={color}
        live={role === "live"}
        startAt={scrubbing ?? entry?.startAt}
        hotCues={liveTrack?.hotCues}
        onPickBar={entry ? (bar) => entry.set({ kind: "bar", bar }) : undefined}
      />
    </section>
  );
}

/**
 * ⏸ / ▶ for a deck during a set. On air: pause (the club hears nothing until
 * ▶) and resume where it stopped. During a mix: ⏸ stops that side and the other
 * song carries on. On the cued deck: ▶ brings it in on the next phrase (or, while
 * the set is paused, starts it at once).
 */
function TransportButton({
  deck,
  role,
  color,
  paused,
  setPaused,
  mixing,
  busy,
  onPause,
  onPlay,
}: {
  deck: number;
  role: "live" | "incoming";
  color: string;
  paused: boolean;
  setPaused: boolean;
  mixing: boolean;
  busy: boolean;
  onPause: () => void;
  onPlay: () => void;
}) {
  const letter = DECK_LETTERS[deck];
  const pause = role === "live" ? !paused : mixing;
  const label = pause ? "⏸ Pause" : role === "live" ? "▶ Resume" : "▶ Play now";
  const name = pause ? `Pause Deck ${letter}` : role === "live" ? `Resume Deck ${letter}` : `Play Deck ${letter} now`;
  const title = pause
    ? mixing
      ? "Stop this side of the mix; the other song carries on"
      : "Pause: the club hears nothing until you press ▶"
    : role === "live"
      ? "Carry on from where it stopped"
      : setPaused
        ? "Start this song now"
        : "Mix it in on the next phrase, beat-matched";
  return (
    <button
      type="button"
      className="btn mt-3 h-14 w-full text-lg font-bold"
      disabled={busy}
      aria-label={name}
      title={title}
      onClick={pause ? onPause : onPlay}
      style={!pause && !busy ? { borderColor: color, color } : undefined}
    >
      {label}
    </button>
  );
}
