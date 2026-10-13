"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SCHEDULE_MARGIN, STOP_FADE_SECONDS, type AutoDJStatus } from "@/lib/dj/autodj";
import { gridPosition, PHRASE_BARS } from "@/lib/dj/mixpoints";

import type { Track, TransitionKind } from "@/lib/types";
import { readyTracks, useLibrary, useMoods } from "@/store/library";
import { useSession } from "@/store/session";
import { DeckPanel, type DeckRole } from "./DeckPanel";
import { formatTime, setText, useBoothFrame } from "./frame";
import { FxPad } from "./FxPad";
import { TrackPicker } from "./TrackPicker";
import { MOOD_COLOR } from "./theme";

const TRANSITION_LABEL: Record<TransitionKind, string> = {
  blend: "Beat-matched blend",
  filterSweep: "Filter sweep",
  echoOut: "Echo-out",
  cut: "Cut on the downbeat",
  drop: "Drop",
};

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
  const ready = readyTracks(tracks).length;

  const status = useSession((s) => s.status);
  const starting = useSession((s) => s.starting);
  const stopping = useSession((s) => s.stopping);
  const resumeAvailable = useSession((s) => s.resumeAvailable);
  const play = useSession((s) => s.play);
  const stop = useSession((s) => s.stop);
  const setMood = useSession((s) => s.setMood);

  const canPlay = hydrated && ready >= 2;
  const tryAutoResume = useSession((s) => s.tryAutoResume);
  useEffect(() => {
    if (canPlay && folderState === "ready" && resumeAvailable) void tryAutoResume();
  }, [canPlay, folderState, resumeAvailable, tryAutoResume]);

  // Track picker: `next` replaces the cued track, otherwise it adds to the queue.
  const [picker, setPicker] = useState<{ next: boolean } | null>(null);
  const closePicker = useCallback(() => setPicker(null), []);

  const moods = useMoods();
  const mood = moods.find((m) => m.id === status.mood)!;
  const color = MOOD_COLOR[status.mood];
  // On air and not fading out: the only time Drop, effects and track choice make sense.
  const live = status.playing && !stopping;
  const deckCount = status.playing ? status.deckCount : settingsDecks;
  const decks = Array.from({ length: deckCount }, (_, i) => {
    const { role, track } = deckRole(status, i);
    const choose =
      role === "live" || !canPlay || stopping
        ? undefined
        : role === "standby"
          ? { label: "Queue track", open: () => setPicker({ next: false }) }
          : { label: track ? "Change track" : "Choose track", open: () => setPicker({ next: true }) };
    return <DeckPanel key={i} deck={i} role={role} track={track} color={color} onChoose={choose} />;
  });

  const centre = (
    <section className="flex flex-col items-center gap-5">
      <PlayStopButton
        playing={status.playing}
        starting={starting}
        stopping={stopping}
        disabled={!canPlay}
        onPlay={play}
        onStop={stop}
      />
      <DropButton status={status} live={live} color={color} />
      <FxPad enabled={live && !!status.now} color={color} />
      <LevelMeter color={color} />
      {status.now && <BeatCounter deck={status.now.deck} track={status.now.track} color={color} />}
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
      <NextMix status={status} color={color} />
      <Queue status={status} enabled={canPlay} onAdd={() => setPicker({ next: false })} />
    </section>
  );

  return (
    <main className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-8" style={{ "--mood": color } as CSSProperties}>
      <BeatPulse deck={status.now?.deck ?? null} track={status.now?.track ?? null} color={color} />
      {picker && <TrackPicker next={picker.next} color={color} onClose={closePicker} />}

      {resumeAvailable && !status.playing && canPlay && (
        <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-warn/10 px-5 py-4">
          <p>The last set was interrupted. Press play to resume in {mood.name}.</p>
        </div>
      )}

      <section aria-labelledby="mood-heading">
        <h2 id="mood-heading" className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">
          Mood
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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

      {deckCount === 2 ? (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_minmax(15rem,18rem)_1fr]">
          {decks[0]}
          <div className="order-first lg:order-none">{centre}</div>
          {decks[1]}
        </div>
      ) : (
        <>
          {centre}
          <div className={`grid gap-6 sm:grid-cols-2 ${deckCount === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>{decks}</div>
        </>
      )}

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
    <div className="relative h-44 w-44">
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
        className={`absolute inset-2 flex flex-col items-center justify-center gap-1 rounded-full text-2xl font-bold text-black transition disabled:cursor-not-allowed ${
          busy ? "" : "disabled:opacity-40"
        }`}
        style={{
          background: tint,
          boxShadow: busy ? "none" : `0 0 48px color-mix(in srgb, ${tint} 35%, transparent)`,
        }}
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
          {stopLook || stopping ? <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /> : <path d="M7 4.5v15l13-7.5z" fill="currentColor" />}
        </svg>
        <span className={busy ? "text-lg" : ""}>{label}</span>
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
  const dropping = status.next?.transition === "drop";
  useBoothFrame((snap) => {
    const mix = snap?.mix;
    const nowBusy = !!mix && snap.now >= mix.start - SCHEDULE_MARGIN;
    if (nowBusy !== busy) setBusy(nowBusy);
    const hits = mix ? (mix.drop ?? mix.start) : 0;
    let text = "Drop";
    if (dropping && mix && snap.now < hits) text = `Drop in ${formatTime(hits - snap.now)}`;
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
      className="h-16 w-56 rounded-full border-2 text-xl font-bold uppercase tracking-[0.2em] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
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

/** Bar, phrase and beat of the live deck. */
function BeatCounter({ deck, track, color }: { deck: number; track: Track; color: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const phrase = useRef<HTMLSpanElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  useBoothFrame((snap) => {
    const view = snap?.decks[deck];
    const a = track.analysis;
    if (!view || !a) return;
    const g = gridPosition(a, view.position);
    setText(bar.current, g.bar >= 0 ? String(g.bar + 1) : "—");
    setText(phrase.current, g.bar >= 0 ? `${Math.floor(g.bar / PHRASE_BARS) + 1}.${(g.bar % PHRASE_BARS) + 1}` : "—");
    dots.current.forEach((el, i) => {
      if (el) el.style.opacity = g.bar >= 0 && g.beat === i ? "1" : "0.15";
    });
  });
  return (
    <div className="flex items-center gap-5 font-mono" aria-hidden>
      <div className="text-center">
        <span ref={bar} className="block text-2xl font-bold tabular-nums">
          —
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted">Bar</span>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            ref={(el) => {
              dots.current[i] = el;
            }}
            className="h-3 w-3 rounded-full"
            style={{ background: i === 0 ? color : "var(--foreground)", opacity: 0.15 }}
          />
        ))}
      </div>
      <div className="text-center">
        <span ref={phrase} className="block text-2xl font-bold tabular-nums">
          —
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted">Phrase</span>
      </div>
    </div>
  );
}

/** Up-next card: countdown to the mix, then a progress bar while it runs. */
function NextMix({ status, color }: { status: AutoDJStatus; color: string }) {
  const when = useRef<HTMLSpanElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  useBoothFrame((snap) => {
    const mix = snap?.mix;
    if (!mix) return;
    if (snap.now < mix.start) {
      setText(when.current, `in ${formatTime(mix.start - snap.now)}`);
      if (progress.current) progress.current.style.transform = "scaleX(0)";
    } else {
      const p = Math.min(1, (snap.now - mix.start) / Math.max(0.1, mix.end - mix.start));
      setText(when.current, `mixing · ${Math.round(p * 100)}%`);
      if (progress.current) progress.current.style.transform = `scaleX(${p})`;
    }
  });
  if (!status.playing) return null;
  return (
    <div className="w-full rounded-2xl border border-border bg-surface/80 p-4 backdrop-blur">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Up next</h3>
      {status.next ? (
        <>
          <p className="mt-1 truncate font-semibold">
            {status.next.track.title}
            {status.next.requested && (
              <span className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase" style={{ background: color, color: "#07070b" }}>
                Requested
              </span>
            )}
          </p>
          <p className="truncate text-sm text-muted">{status.next.track.artist || "Unknown artist"}</p>
          <p className="mt-2 flex justify-between gap-2 font-mono text-xs text-muted">
            <span>{TRANSITION_LABEL[status.next.transition]}</span>
            <span ref={when} className="tabular-nums" />
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div ref={progress} className="h-full origin-left rounded-full" style={{ background: color, transform: "scaleX(0)" }} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-muted">Choosing…</p>
      )}
    </div>
  );
}

/** Staff-requested tracks waiting after the next one. */
function Queue({ status, enabled, onAdd }: { status: AutoDJStatus; enabled: boolean; onAdd: () => void }) {
  const unrequest = useSession((s) => s.unrequest);
  return (
    <div className="w-full rounded-2xl border border-border bg-surface/80 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Queue {status.queue.length > 0 && `· ${status.queue.length}`}</h3>
        <button type="button" onClick={onAdd} disabled={!enabled} className="btn">
          Add track
        </button>
      </div>
      {status.queue.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Empty — the auto-DJ picks for the mood.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {status.queue.map((t, i) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <span className="w-4 font-mono text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <button
                type="button"
                onClick={() => unrequest(t.id)}
                aria-label={`Remove ${t.title} from the queue`}
                className="rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-foreground"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
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
    <div className="h-2 w-56 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div
        ref={bar}
        className="h-full origin-left"
        style={{ background: `linear-gradient(90deg, var(--accent-2), ${color})`, transform: "scaleX(0)" }}
      />
    </div>
  );
}
