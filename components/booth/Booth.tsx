"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SCHEDULE_MARGIN, STOP_FADE_SECONDS, type AutoDJStatus } from "@/lib/dj/autodj";
import { cuePlan, firstStart, resolveEntry } from "@/lib/dj/cues";
import { gridPosition } from "@/lib/dj/mixpoints";

import type { EntryChoice, Track } from "@/lib/types";
import { previewIsSeparate, readyTracks, useLibrary, useMoods } from "@/store/library";
import { useSession } from "@/store/session";
import { DeckPanel, type DeckRole } from "./DeckPanel";
import { ListenButtons, LoadButton, Mixer, type Channel } from "./Mixer";
import { TrackStack, type StackRow } from "./TrackStack";
import { formatTime, setText, useBoothFrame } from "./frame";
import { FxPad } from "./FxPad";
import { TrackPicker } from "./TrackPicker";
import { MOOD_COLOR } from "./theme";


function deckRole(status: AutoDJStatus, deck: number): { role: DeckRole; track: Track | null } {
  if (status.now?.deck === deck) return { role: "live", track: status.now.track };
  if (status.next?.deck === deck) return { role: "incoming", track: status.next.track };
  if (status.standby?.deck === deck) return { role: "standby", track: status.standby.track };
  return { role: "idle", track: null };
}

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
  const settingsDecks = useLibrary((s) => s.settings.deckCount);
  // Cue during a set needs its own output, or the club would hear it.
  const previewSeparate = useLibrary((s) => previewIsSeparate(s.settings));
  const ready = readyTracks(tracks).length;

  const status = useSession((s) => s.status);
  const starting = useSession((s) => s.starting);
  const stopping = useSession((s) => s.stopping);
  const resumeAvailable = useSession((s) => s.resumeAvailable);
  const play = useSession((s) => s.play);
  const stop = useSession((s) => s.stop);
  const setMood = useSession((s) => s.setMood);
  const setEntry = useSession((s) => s.setEntry);

  const canPlay = hydrated && ready >= 2;
  const tryAutoResume = useSession((s) => s.tryAutoResume);
  useEffect(() => {
    if (canPlay && folderState === "ready" && resumeAvailable) void tryAutoResume();
  }, [canPlay, folderState, resumeAvailable, tryAutoResume]);

  // Track picker: `next` replaces the cued track, otherwise it adds to the queue.
  const [picker, setPicker] = useState<{ next: boolean; loadDeck?: number } | null>(null);
  const preloads = useSession((s) => s.preloads);
  const ejectDeck = useSession((s) => s.ejectDeck);
  const setPreloadEntry = useSession((s) => s.setPreloadEntry);
  const closePicker = useCallback(() => setPicker(null), []);

  const moods = useMoods();
  const mood = moods.find((m) => m.id === status.mood)!;
  const color = MOOD_COLOR[status.mood];
  // On air and not fading out: the only time Drop, effects and track choice make sense.
  // Paused: Drop, Layer and effects wait for ▶.
  const live = status.playing && !stopping && !status.silent;
  const deckCount = status.playing ? status.deckCount : settingsDecks;
  // Where a song loaded before Play starts: Deck A where the set starts, the others where they'll come in.
  const preloadStart = (i: number, p: NonNullable<(typeof preloads)[number]>) =>
    i === 0 ? firstStart(p.track, p.entry, !!mood.opener).start : ((e) => e.dialogue?.start ?? e.land)(resolveEntry(p.track, p.entry));
  // Track view: the decks' songs one below another (loaded ones before Play; on air and cued during the set).
  // A row for every deck (empty ones too), so the view never changes height.
  const stackRows: StackRow[] = Array.from({ length: deckCount }, (_, i): StackRow => {
    if (!status.playing && !starting) {
      const p = preloads[i];
      return p ? { deck: i, track: p.track, role: "loaded", startAt: preloadStart(i, p) } : { deck: i, track: null, role: "idle" };
    }
    const { role, track } = deckRole(status, i);
    if (!track || (role !== "live" && role !== "incoming")) return { deck: i, track: null, role };
    return { deck: i, track, role, startAt: role === "incoming" ? status.next?.startAt : undefined };
  });
  // Each deck's panel props and its mixer channel (LOAD, 🎧 CUE). Before Play staff can load a song into any
  // deck (Deck A plays first, the rest next in order).
  const setup = Array.from({ length: deckCount }, (_, i): { panel: Parameters<typeof DeckPanel>[0]; channel: Channel } => {
    if (!status.playing && !starting) {
      const preload = preloads[i] ?? null;
      const entry = preload
        ? {
            choice: preload.entry,
            // Deck A: where the set starts. Later decks: where they'll come in (before any build-up).
            startAt: preloadStart(i, preload),
            set: (choice: EntryChoice) => setPreloadEntry(i, choice),
          }
        : undefined;
      return {
        panel: {
          deck: i,
          role: preload ? "loaded" : "idle",
          track: preload?.track ?? null,
          color,
          onEject: preload ? () => ejectDeck(i) : undefined,
          entry,
          onStart: preload && canPlay ? () => void play(i) : undefined,
        },
        channel: {
          deck: i,
          track: preload?.track ?? null,
          choose: canPlay ? { label: preload ? "Change" : "Load track", open: () => setPicker({ next: false, loadDeck: i }) } : undefined,
          cue: preload ? { plan: cuePlan(preload.track, preload.entry, i === 0, !!mood.opener), blocked: false } : undefined,
          entry,
        },
      };
    }
    const { role, track } = deckRole(status, i);
    const choose =
      role === "live" || !canPlay || stopping
        ? undefined
        : role === "standby"
          ? { label: "Queue track", open: () => setPicker({ next: false }) }
          : { label: track ? "Change track" : "Choose track", open: () => setPicker({ next: true }) };
    const entry = role === "incoming" && status.next && !stopping ? { choice: status.next.entry, startAt: status.next.startAt, set: setEntry } : undefined;
    return {
      panel: {
        deck: i,
        role,
        track,
        color,
        keyLock: status.playing && status.keyLock,
        entry,
        // ⏏ during the set: the next song's deck (the panel greys it out while that song plays).
        onEject: role === "incoming" && !stopping ? () => ejectDeck(i) : undefined,
        transport:
          status.playing && !stopping
            ? {
                setPaused: status.silent,
                thisPaused: status.paused === i || status.pausedAlong === i,
                tempo: role === "incoming" ? status.next?.tempo : undefined,
                cuePoint: status.cuePoints[i] ?? null,
              }
            : undefined,
      },
      channel: {
        deck: i,
        track,
        choose,
        cue: role === "incoming" && status.next && !stopping ? { plan: cuePlan(status.next.track, status.next.entry, false), blocked: !previewSeparate } : undefined,
        entry,
      },
    };
  });
  // Decks C and D (3–4 decks): the mixer has two channels, so they carry their own LOAD and 🎧 CUE.
  const deckPanel = (i: number) => (
    <DeckPanel
      key={i}
      {...setup[i].panel}
      strip={
        i >= 2 ? (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <LoadButton channel={setup[i].channel} />
            <ListenButtons channel={setup[i].channel} />
          </div>
        ) : undefined
      }
    />
  );

  const mixer = (
    <Mixer
      channels={[setup[0].channel, setup[1].channel]}
      color={color}
      playing={status.playing}
      playStop={
        <PlayStopButton
          playing={status.playing}
          starting={starting}
          stopping={stopping}
          disabled={!canPlay}
          onPlay={() => void play()}
          onStop={stop}
        />
      }
      meterBar={<LevelMeter color={color} />}
      aiDj={<AiDjSwitch on={status.auto} disabled={!status.playing || stopping} color={color} />}
      drop={<DropButton status={status} live={live} color={color} />}
      fx={<FxPad enabled={live && !!status.now} color={color} />}
    />
  );

  // Notes from the auto-DJ (and the library link), in a fixed-height strip so the booth never jumps.
  const notes = (
    <div className="h-5 truncate text-center text-sm leading-5" aria-live="polite">
      {status.error && <span className="text-bad">{status.error} </span>}
      {status.note && <span className="text-warn">{status.note} </span>}
      {!canPlay && hydrated && (
        <span className="text-muted">
          {folderState === "none" && ready === 0 ? "No music folder connected. " : `Only ${ready} analysed track${ready === 1 ? "" : "s"}. `}
          <Link href="/library" className="text-accent underline">
            Open the library
          </Link>
        </span>
      )}
    </div>
  );

  return (
    // One gap (1 rem) between every block: mood, track view, decks.
    <main className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-8" style={{ "--mood": color } as CSSProperties}>
      <BeatPulse deck={status.now?.deck ?? null} track={status.now?.track ?? null} color={color} />
      {picker && <TrackPicker next={picker.next} loadDeck={picker.loadDeck} color={color} onClose={closePicker} />}

      {resumeAvailable && !status.playing && canPlay && (
        <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-warn/10 px-5 py-4">
          <p>The last set was interrupted. Press play to resume in {mood.name}.</p>
        </div>
      )}

      {/* Floats over the page (fixed), so the booth doesn't move when it appears. */}
      {status.silent && status.paused !== null && status.holding === null && (
        <div
          role="status"
          className="fixed inset-x-4 top-20 z-40 mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl border-2 border-warn bg-[#1f1708]/95 px-5 py-4 text-center shadow-2xl backdrop-blur"
        >
          <p className="text-2xl font-bold text-warn">Paused</p>
          <p className="text-lg">
            The club hears nothing.{" "}
            {status.pausedAlong !== null ? (
              <>
                Press <strong>▶ Play</strong> on Deck {"ABCD"[status.paused]} or Deck {"ABCD"[status.pausedAlong]}.
              </>
            ) : (
              <>
                Press <strong>▶ Play</strong> on Deck {"ABCD"[status.paused]}, or on the cued deck.
              </>
            )}
          </p>
        </div>
      )}

      <section aria-labelledby="mood-heading">
        <h2 id="mood-heading" className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">
          Mood
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {moods.map((m) => {
            const active = status.mood === m.id;
            const c = MOOD_COLOR[m.id];
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMood(m.id)}
                aria-pressed={active}
                className="rounded-2xl border px-4 py-5 text-left transition duration-300 hover:bg-surface-2"
                style={
                  active
                    ? { borderColor: c, background: `color-mix(in srgb, ${c} 22%, var(--surface))`, boxShadow: `0 0 32px color-mix(in srgb, ${c} 35%, transparent)` }
                    : { borderColor: "var(--border)", background: "var(--surface)" }
                }
              >
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                  {m.name}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {m.bpm[0]}–{m.bpm[1]} BPM
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <TrackStack rows={stackRows} color={color} notes={notes} />

      {/* The controller, laid out like a DDJ-FLX4: Deck A · mixer · Deck B (decks C and D below). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem_minmax(0,1fr)]">
        {deckPanel(0)}
        {mixer}
        {deckPanel(1)}
      </div>
      {deckCount > 2 && <div className="grid items-start gap-4 lg:grid-cols-2">{setup.slice(2).map((_, k) => deckPanel(k + 2))}</div>}

      <footer className="mt-auto text-center text-xs text-muted">
        {ready} tracks ready
        {analysis ? ` · analysing ${analysis.done + 1}/${analysis.total}` : ""} · {mood.description}
      </footer>
    </main>
  );
}

/** Mood-coloured glow behind the booth that pulses on the live deck's beats. */
function BeatPulse({ deck, track, color }: { deck: number | null; track: Track | null; color: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useBoothFrame((snap) => {
    if (!layer.current) return;
    const view = deck === null ? null : snap?.decks[deck];
    const a = track?.analysis;
    let pulse = 0;
    if (view && a && !reduced.current) {
      const g = gridPosition(a, view.position);
      if (g.bar >= 0) pulse = Math.exp(-g.phase * 5) * (g.beat === 0 ? 1 : 0.6);
    }
    layer.current.style.opacity = String(view ? 0.35 + pulse * 0.45 : 0.2);
  });
  return (
    <div
      ref={layer}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 transition-[background] duration-700"
      style={{ background: `radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, ${color} 30%, transparent), transparent 70%)`, opacity: 0.2 }}
    />
  );
}

/**
 * Play / Stop. While the set starts or fades out, the button is disabled and
 * says so — a spinning ring while starting, a ring draining over the
 * STOP_FADE_SECONDS fade-out — so a second press can't restart or re-stop it.
 */
function PlayStopButton({
  playing,
  starting,
  stopping,
  disabled,
  onPlay,
  onStop,
}: {
  playing: boolean;
  starting: boolean;
  stopping: boolean;
  disabled: boolean;
  onPlay: () => void;
  onStop: () => void;
}) {
  const busy = starting || stopping;
  const stopLook = (playing && !stopping) || starting;
  const label = starting ? "Starting…" : stopping ? "Stopping…" : playing ? "Stop" : "Play";
  const tint = stopping ? "#9a9aae" : stopLook ? "#f87171" : "#34d399";
  return (
    <div className="relative h-28 w-28 shrink-0">
      {busy && (
        <svg viewBox="0 0 100 100" className={`absolute inset-0 -rotate-90 ${starting ? "animate-spin" : ""}`} aria-hidden>
          <circle cx="50" cy="50" r="48" fill="none" stroke="var(--surface-2)" strokeWidth="3" />
          <circle
            cx="50"
            cy="50"
            r="48"
            fill="none"
            stroke={tint}
            strokeWidth="3"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={starting ? "25 75" : "100"}
            style={stopping ? { animation: `ring-drain ${STOP_FADE_SECONDS}s linear forwards` } : undefined}
          />
        </svg>
      )}
      <button
        type="button"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => (playing ? onStop() : onPlay())}
        className={`absolute inset-1.5 flex flex-col items-center justify-center gap-0.5 rounded-full text-lg font-bold text-black transition disabled:cursor-not-allowed ${
          busy ? "" : "disabled:opacity-40"
        }`}
        style={{
          background: tint,
          boxShadow: busy ? "none" : `0 0 48px color-mix(in srgb, ${tint} 35%, transparent)`,
        }}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
          {stopLook || stopping ? <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /> : <path d="M7 4.5v15l13-7.5z" fill="currentColor" />}
        </svg>
        <span className={busy ? "text-sm" : ""}>{label}</span>
      </button>
    </div>
  );
}

/**
 * Drop: bring the next track in on its drop at the next 4-bar boundary.
 * Disabled while a transition is running or about to, and while stopping.
 */
function DropButton({ status, live, color }: { status: AutoDJStatus; live: boolean; color: string }) {
  const drop = useSession((s) => s.drop);
  const label = useRef<HTMLSpanElement>(null);
  // React state, not a DOM write: React skips onClick when the *prop* says disabled.
  const [busy, setBusy] = useState(false);
  // A Drop (or drop swap, or a layer's swap) is armed — not a Desi Night song that's waiting for one.
  const layered = status.next?.transition === "layer";
  const dropping = (status.next?.transition === "drop" || status.next?.transition === "dialogue" || layered) && !status.next?.holding;
  useBoothFrame((snap) => {
    const mix = snap?.mix;
    // Busy while a mix is under way (except a layer waiting for Drop), or while the live song is in its dialogue.
    const nowBusy = (!!mix && snap.now >= mix.start - SCHEDULE_MARGIN && !snap.layering) || !!snap?.dropLocked;
    if (nowBusy !== busy) setBusy(nowBusy);
    const hits = mix ? (mix.drop ?? mix.start) : 0;
    let text = "Drop";
    if (snap?.layering) text = "Drop · swap";
    else if (layered && mix?.drop !== undefined && snap!.now < hits) text = `Swap in ${formatTime(hits - snap!.now)}`;
    else if (dropping && !layered && mix && snap.now < hits) text = `Drop in ${formatTime(hits - snap.now)}`;
    else if (snap?.dropLocked) text = "Dialogue…";
    else if (nowBusy) text = "Mixing…";
    setText(label.current, text);
  });
  const disabled = !live || !status.now || busy;
  return (
    <button
      type="button"
      onClick={drop}
      disabled={disabled}
      title="Bring the next track in on its drop"
      className="h-14 w-full rounded-full border-2 text-lg font-bold uppercase tracking-[0.2em] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
      style={{
        borderColor: color,
        color: dropping ? "#07070b" : color,
        background: dropping ? color : `color-mix(in srgb, ${color} 12%, transparent)`,
        boxShadow: `0 0 28px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span ref={label}>Drop</span>
    </button>
  );
}


/**
 * AI DJ mode. On: the auto-DJ mixes songs nobody has touched (once staff play,
 * pause or cue a song, that one plays to its end). Off: it still cues the best
 * next song but never mixes — each song plays to its end and the next starts.
 */
function AiDjSwitch({ on, disabled, color }: { on: boolean; disabled: boolean; color: string }) {
  const setAuto = useSession((s) => s.setAuto);
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="AI DJ"
        disabled={disabled}
        onClick={() => setAuto(!on)}
        className="flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm font-bold transition disabled:opacity-40"
        style={on ? { borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface))` } : { borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, var(--surface))" }}
      >
        <span>AI DJ</span>
        <span
          className="relative h-6 w-11 rounded-full transition"
          style={{ background: on ? color : "var(--surface-2)" }}
          aria-hidden
        >
          <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? "1.375rem" : "0.125rem" }} />
        </span>
        <span className="w-8 text-right text-sm" style={{ color: on ? color : "var(--warn)" }}>
          {on ? "ON" : "OFF"}
        </span>
      </button>
      <p className="min-h-[2rem] text-center text-xs text-warn" style={{ visibility: on ? "hidden" : "visible" }} aria-hidden={on}>
        No automatic mixing: each song plays to its end, then the next one starts. Mix with Drop or ▶.
      </p>
    </div>
  );
}

/** Master level bar, updated every frame without re-rendering React. */
function LevelMeter({ color }: { color: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const level = useSession((s) => s.level);
  useBoothFrame(() => {
    if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, level() * 4)})`;
  });
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#050506]" aria-hidden title="Master level">
      <div
        ref={bar}
        className="h-full origin-left"
        style={{ background: `linear-gradient(90deg, var(--accent-2), ${color})`, transform: "scaleX(0)" }}
      />
    </div>
  );
}
