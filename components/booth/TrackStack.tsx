"use client";

import { useEffect, useRef, useState } from "react";
import { drops } from "@/lib/analysis/structure";
import type { Waveform } from "@/lib/analysis/waveform";
import { barSeconds, gridPosition, PHRASE_BARS } from "@/lib/dj/mixpoints";
import { waveformFor } from "@/lib/library/waveform";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { useSession } from "@/store/session";
import type { DeckRole } from "./DeckPanel";
import { PAD_LETTERS } from "./CuePads";
import { formatTime, setText, useBoothFrame } from "./frame";
import { DECK_LETTERS } from "./theme";

export interface StackRow {
  deck: number;
  track: Track;
  role: DeckRole;
  /** Where a loaded or cued song will start (track seconds). */
  startAt?: number;
}

/** Seconds of music across a row (room time, so beat-matched decks line up). */
const ZOOMS = [4, 8, 16, 32];

/**
 * Track view: the decks' songs one below another, each a zoomed waveform that
 * scrolls past a centre playhead, with its beat grid (bar numbers, phrases in
 * the mood colour), drops, cue pads and the next mix point, plus the song's
 * details and where it is in the bar and phrase. Rows share one time scale, so
 * while the auto-DJ mixes you can see the two songs' beats line up. A cued song
 * scrolls in from the right before it starts. Display only.
 */
export function TrackStack({ rows, color }: { rows: StackRow[]; color: string }) {
  const [zoom, setZoom] = useState(1);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="track-view-heading" className="rounded-3xl border border-border bg-surface/80 p-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="track-view-heading" className="text-sm font-medium uppercase tracking-wider text-muted">
          Track view
        </h2>
        <div className="flex items-center gap-1.5 text-sm" role="group" aria-label="Zoom">
          <button type="button" className="btn h-8 w-8 px-0" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} aria-label="Zoom out">
            −
          </button>
          <span className="w-12 text-center font-mono text-xs text-muted">{ZOOMS[zoom]} s</span>
          <button type="button" className="btn h-8 w-8 px-0" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <Row key={`${r.deck}:${r.track.id}`} row={r} color={color} span={ZOOMS[zoom]} />
        ))}
      </div>
    </section>
  );
}

const ROLE_LABEL: Partial<Record<DeckRole, string>> = { live: "On air", incoming: "Cued", loaded: "Loaded" };

function Row({ row, color, span }: { row: StackRow; color: string; span: number }) {
  const { deck, role, startAt } = row;
  // The library's copy: cue pads change while the song plays.
  const track = useLibrary((s) => s.tracks[row.track.id]) ?? row.track;
  const getFile = useLibrary((s) => s.getFile);
  const a = track.analysis;
  const [wave, setWave] = useState<Waveform | null>(null);
  useEffect(() => {
    let live = true;
    void waveformFor(row.track, getFile).then((w) => live && setWave(w));
    return () => {
      live = false;
    };
  }, [row.track, getFile]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const bpm = useRef<HTMLSpanElement>(null);
  const tempo = useRef<HTMLSpanElement>(null);
  const time = useRef<HTMLParagraphElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const phrase = useRef<HTMLSpanElement>(null);
  const next = useRef<HTMLParagraphElement>(null);
  const dots = useRef<(HTMLSpanElement | null)[]>([]);

  // Keep the canvas at its on-screen size in device pixels.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(el.clientWidth * dpr));
      el.height = Math.max(1, Math.round(el.clientHeight * dpr));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sectionsRef = useRef<{ start: number; end: number }[]>([]);
  useEffect(() => {
    sectionsRef.current = a?.barLevels ? drops(a.barLevels, a.fullLevel) : [];
  }, [a]);

  useBoothFrame((snap) => {
    const el = canvas.current;
    const g2 = el?.getContext("2d");
    if (!el || !g2 || !a) return;
    const view = snap?.decks[deck] ?? null;
    const rate = view?.rate ?? 1;
    // Where the song is (a cued song before its start: where it would be, so it scrolls in).
    const pos = view ? (view.started ? view.position : view.position - Math.max(0, view.startsAt - snap!.now) * rate) : (startAt ?? 0);
    const mixing = !!snap?.mix && snap.now >= snap.mix.start;
    // Two songs layered or playing together: the one on air stays on air until they swap.
    const together = useSession.getState().status.next?.together;
    setText(
      badge.current,
      snap?.layering
        ? role === "incoming"
          ? together
            ? "Playing along"
            : "Layered"
          : (ROLE_LABEL[role] ?? "")
        : role === "live" && mixing
          ? "Mixing out"
          : role === "incoming" && mixing
            ? "Mixing in"
            : (ROLE_LABEL[role] ?? ""),
    );
    setText(bpm.current, (a.bpm * rate).toFixed(1));
    const pct = (rate - 1) * 100;
    setText(tempo.current, Math.abs(pct) >= 0.05 ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "own tempo");
    setText(time.current, `${formatTime(Math.max(0, pos))} / −${formatTime(Math.max(0, a.duration - Math.max(0, pos)))}`);
    const g = gridPosition(a, pos);
    setText(bar.current, g.bar >= 0 ? `${g.bar + 1}.${g.beat + 1}` : "—");
    setText(phrase.current, g.bar >= 0 ? `${Math.floor(g.bar / PHRASE_BARS) + 1} · ${(g.bar % PHRASE_BARS) + 1}/${PHRASE_BARS}` : "—");
    dots.current.forEach((d, i) => {
      if (d) d.style.opacity = g.bar >= 0 && g.beat === i ? "1" : "0.15";
    });
    // What comes next: the mix, the song's start, or its next drop.
    const barSec = barSeconds(a);
    const inDrop = sectionsRef.current.find((s) => g.bar >= s.start && g.bar < s.end);
    const nextDrop = sectionsRef.current.find((s) => s.start > g.bar);
    const lines: string[] = [];
    if (role === "incoming" && view && !view.started && snap) lines.push(`in ${formatTime(view.startsAt - snap.now)}`);
    else if (role === "live" && snap?.mix && snap.now < snap.mix.start) lines.push(`mix in ${formatTime(snap.mix.start - snap.now)}`);
    if (inDrop) lines.push("in a drop");
    else if (nextDrop) lines.push(`drop in ${formatTime((a.firstBeat + nextDrop.start * barSec - pos) / rate)}`);
    setText(next.current, lines.join(" · "));

    draw(g2, el.width, el.height, {
      a,
      wave,
      pos,
      rate,
      span,
      color,
      drops: sectionsRef.current,
      cues: track.hotCues ?? [],
      loops: (snap?.loops ?? useSession.getState().status.loops).filter((l) => l.deck === deck),
      saved: track.savedLoops ?? [],
      mark:
        role === "live" && snap?.mixOutPosition != null
          ? { at: snap.mixOutPosition, label: "MIX" }
          : (role === "incoming" || role === "loaded") && startAt !== undefined
            ? { at: startAt, label: "IN" }
            : null,
    });
  });

  return (
    <div className="grid items-stretch gap-3 rounded-2xl border border-border bg-surface-2/50 p-2 md:grid-cols-[13rem_1fr_9rem]" aria-label={`Track view, Deck ${DECK_LETTERS[deck]}`} role="group">
      <div className="min-w-0 px-1">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md text-xs font-bold text-black" style={{ background: color }}>
            {DECK_LETTERS[deck]}
          </span>
          <span ref={badge} className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {ROLE_LABEL[role]}
          </span>
          <span className="ml-auto font-mono text-xs text-muted">{track.camelot ?? "key —"}</span>
        </div>
        <p className="mt-1 truncate font-semibold">{track.title}</p>
        <p className="truncate text-xs text-muted">{track.artist || "Unknown artist"}</p>
        <p className="mt-1 flex items-baseline gap-1.5 font-mono text-xs text-muted">
          <span ref={bpm} className="text-base font-bold text-foreground tabular-nums">
            {a?.bpm.toFixed(1) ?? "—"}
          </span>
          BPM <span ref={tempo} />
        </p>
        <p ref={time} className="font-mono text-xs text-muted tabular-nums" />
      </div>
      <canvas ref={canvas} className="h-24 w-full rounded-xl bg-[#07070b]" aria-hidden />
      <div className="flex flex-col justify-center gap-1 px-1 font-mono" aria-hidden>
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
        <p className="text-xs text-muted">
          Bar <span ref={bar} className="text-base font-bold text-foreground tabular-nums" />
        </p>
        <p className="text-[11px] text-muted">
          Phrase <span ref={phrase} className="text-foreground" />
        </p>
        <p ref={next} className="text-[11px] text-muted" />
      </div>
    </div>
  );
}

interface DrawOptions {
  a: NonNullable<Track["analysis"]>;
  wave: Waveform | null;
  pos: number;
  rate: number;
  span: number;
  color: string;
  drops: { start: number; end: number }[];
  cues: (number | null)[];
  mark: { at: number; label: string } | null;
  /** Loops playing (shaded) or armed (shaded, dashed edges) on this deck. */
  loops: { start: number; end: number; armed: boolean }[];
  /** The song's saved loops (outlined). */
  saved: { start: number; end: number }[];
}

/** One frame of a row: waveform, drops, beat grid, cue pads, the mix / start point and the playhead. */
function draw(g: CanvasRenderingContext2D, W: number, H: number, o: DrawOptions) {
  const { a, wave, pos, rate, span, color } = o;
  const dpr = window.devicePixelRatio || 1;
  const pxPerSec = W / span;
  const xOf = (t: number) => W / 2 + ((t - pos) / rate) * pxPerSec;
  const tOf = (x: number) => pos + ((x - W / 2) / pxPerSec) * rate;
  const mid = H / 2;
  const half = H / 2 - 14 * dpr;
  g.clearRect(0, 0, W, H);

  // Drops: a band in the mood colour along the top.
  const barSec = barSeconds(a);
  g.fillStyle = color;
  g.globalAlpha = 0.18;
  for (const d of o.drops) {
    const x0 = xOf(a.firstBeat + d.start * barSec);
    const x1 = xOf(a.firstBeat + d.end * barSec);
    if (x1 > 0 && x0 < W) g.fillRect(x0, 0, x1 - x0, H);
  }
  g.globalAlpha = 1;

  // The waveform: everything in soft white, the bass in the mood colour.
  if (wave) {
    for (let x = 0; x < W; x++) {
      const t0 = tOf(x);
      const t1 = tOf(x + 1);
      if (t1 < 0 || t0 > a.duration) continue;
      const b0 = Math.max(0, Math.floor(t0 * wave.rate));
      const b1 = Math.min(wave.peak.length, Math.max(b0 + 1, Math.ceil(t1 * wave.rate)));
      let p = 0;
      let l = 0;
      for (let b = b0; b < b1; b++) {
        if (wave.peak[b] > p) p = wave.peak[b];
        if (wave.low[b] > l) l = wave.low[b];
      }
      const hp = (p / 255) * half;
      const hl = (l / 255) * half;
      g.fillStyle = "rgba(242,242,247,0.35)";
      g.fillRect(x, mid - hp, 1, 2 * hp);
      g.fillStyle = color;
      g.fillRect(x, mid - hl, 1, 2 * hl);
    }
  } else if (a.barLevels) {
    // Still preparing the waveform: the bass level of each bar.
    g.fillStyle = color;
    g.globalAlpha = 0.45;
    a.barLevels.forEach((lv, i) => {
      const x0 = xOf(a.firstBeat + i * barSec);
      const x1 = xOf(a.firstBeat + (i + 1) * barSec);
      if (x1 > 0 && x0 < W) g.fillRect(x0, mid - lv * half, Math.max(1, x1 - x0 - dpr), 2 * lv * half);
    });
    g.globalAlpha = 1;
  }

  // Beat grid: beats faint, bars brighter and numbered, phrase starts in the mood colour.
  const beat = 60 / a.bpm;
  const k0 = Math.ceil((tOf(0) - a.firstBeat) / beat);
  const k1 = Math.floor((tOf(W) - a.firstBeat) / beat);
  g.font = `${10 * dpr}px ui-monospace, monospace`;
  g.textBaseline = "top";
  for (let k = k0; k <= k1; k++) {
    const x = Math.round(xOf(a.firstBeat + k * beat));
    const downbeat = ((k % 4) + 4) % 4 === 0;
    const barIndex = Math.floor(k / 4);
    const phraseStart = downbeat && barIndex >= 0 && barIndex % PHRASE_BARS === 0;
    g.fillStyle = phraseStart ? color : downbeat ? "rgba(242,242,247,0.55)" : "rgba(242,242,247,0.16)";
    g.fillRect(x, 0, phraseStart ? 2 * dpr : dpr, H);
    if (downbeat && barIndex >= 0 && (span <= 16 || barIndex % 4 === 0)) {
      g.fillStyle = phraseStart ? color : "rgba(242,242,247,0.7)";
      g.fillText(String(barIndex + 1), x + 3 * dpr, 2 * dpr);
    }
  }

  // Cue pads along the bottom.
  g.textBaseline = "bottom";
  o.cues.forEach((at, i) => {
    if (at === null) return;
    const x = xOf(at);
    if (x < -20 || x > W + 20) return;
    g.fillStyle = "#f2f2f7";
    g.fillRect(x, H - 14 * dpr, dpr * 1.5, 14 * dpr);
    g.fillRect(x, H - 14 * dpr, 11 * dpr, 12 * dpr);
    g.fillStyle = "#07070b";
    g.fillText(PAD_LETTERS[i], x + 2 * dpr, H - 3 * dpr);
  });

  // The next mix point (song on air) or where the song comes in (cued / loaded).
  if (o.mark) {
    const x = xOf(o.mark.at);
    if (x > -40 && x < W + 40) {
      g.fillStyle = "#fbbf24";
      g.fillRect(x, 0, 2 * dpr, H);
      g.textBaseline = "top";
      g.fillText(o.mark.label, x + 4 * dpr, 14 * dpr);
    }
  }

  // Saved loops: outlined. Loops playing: shaded with solid edges; armed: shaded with dashed edges.
  g.strokeStyle = "rgba(251,191,36,0.55)";
  g.lineWidth = dpr;
  g.setLineDash([4 * dpr, 3 * dpr]);
  for (const l of o.saved) {
    const x0 = xOf(l.start);
    const x1 = xOf(l.end);
    if (x1 > 0 && x0 < W) g.strokeRect(x0, 1.5 * dpr, x1 - x0, H - 3 * dpr);
  }
  g.setLineDash([]);
  for (const l of o.loops) {
    const x0 = xOf(l.start);
    const x1 = xOf(l.end);
    if (x1 < 0 || x0 > W) continue;
    g.fillStyle = "#fbbf24";
    g.globalAlpha = 0.2;
    g.fillRect(x0, 0, x1 - x0, H);
    g.globalAlpha = 1;
    if (l.armed) g.setLineDash([5 * dpr, 4 * dpr]);
    g.strokeStyle = "#fbbf24";
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(x0, 0);
    g.lineTo(x0, H);
    g.moveTo(x1, 0);
    g.lineTo(x1, H);
    g.stroke();
    g.setLineDash([]);
    g.textBaseline = "top";
    g.fillText(l.armed ? "LOOP ▶" : "LOOP", x0 + 4 * dpr, 26 * dpr);
  }

  // The playhead.
  g.fillStyle = "#ffffff";
  g.fillRect(Math.round(W / 2 - dpr), 0, 2 * dpr, H);
}
