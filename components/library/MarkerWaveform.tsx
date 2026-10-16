"use client";

import { useEffect, useRef, useState } from "react";
import { drops } from "@/lib/analysis/structure";
import type { Waveform } from "@/lib/analysis/waveform";
import { snapToBar } from "@/lib/dj/cues";
import { barSeconds } from "@/lib/dj/mixpoints";
import { waveformFor } from "@/lib/library/waveform";
import type { Track, TrackCues } from "@/lib/types";
import { useLibrary } from "@/store/library";

type MarkerKey = keyof TrackCues;

const MARKERS: { key: MarkerKey; label: string; tag: string; color: string; snap: boolean }[] = [
  { key: "dialogueStart", label: "Dialogue start", tag: "D▸", color: "#22d3ee", snap: false },
  { key: "dialogueEnd", label: "Dialogue end", tag: "◂D", color: "#22d3ee", snap: false },
  { key: "hookStart", label: "Hook start", tag: "H▸", color: "#a78bfa", snap: true },
  { key: "hookEnd", label: "Hook end", tag: "◂H", color: "#a78bfa", snap: true },
  { key: "start", label: "Default start", tag: "⚑", color: "#f2f2f7", snap: true },
];
/** Seconds across the zoomed view. */
const ZOOMS = [2, 4, 8, 16, 32];
/** Grab a marker within this many CSS pixels of it. */
const HIT_PX = 10;

/** m:ss.ss */
function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(2).padStart(5, "0")}`;
}

/**
 * Song markers on the song's waveform. The overview shows the whole song (click
 * to look there, double-click to listen); the zoomed view below shows a few
 * seconds with every beat. Drag a marker's handle to move it, drag the waveform
 * (or swipe on a trackpad) to scroll, click to put the cursor there and listen,
 * then "Set … here" places a marker exactly at the cursor. Hook and default start
 * snap to the bar; the dialogue is exact.
 */
export function MarkerWaveform({
  track,
  onSet,
  onListen,
  playhead,
  canListen,
}: {
  track: Track;
  onSet: (key: MarkerKey, seconds: number | null) => void;
  /** Play the song from a position on the preview output. */
  onListen: (from: number) => void;
  /** The preview playhead (track seconds), or null when not playing. */
  playhead: () => number | null;
  canListen: boolean;
}) {
  const a = track.analysis!;
  const getFile = useLibrary((s) => s.getFile);
  const [wave, setWave] = useState<Waveform | null>(null);
  const [zoom, setZoom] = useState(2);
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void waveformFor(track, getFile).then((w) => live && setWave(w));
    return () => {
      live = false;
    };
  }, [track, getFile]);

  const overview = useRef<HTMLCanvasElement>(null);
  const detail = useRef<HTMLCanvasElement>(null);
  // View state lives in refs so dragging and the playhead redraw without re-rendering.
  const focus = useRef(Math.min(a.duration / 2, a.firstBeat + 8 * barSeconds(a)));
  const follow = useRef(false);
  const dragging = useRef<{ key: MarkerKey; value: number } | null>(null);
  const pan = useRef<{ x: number; focus: number; moved: boolean } | null>(null);
  const latest = useRef({ cues: track.cues ?? {}, zoom, cursor, wave });
  const drawRef = useRef<() => void>(() => undefined);

  const sections = useRef(a.barLevels ? drops(a.barLevels, a.fullLevel) : []);
  const span = () => ZOOMS[latest.current.zoom];
  const viewStart = () => Math.max(0, Math.min(Math.max(0, a.duration - span()), focus.current - span() / 2));
  const markerValue = (key: MarkerKey) => (dragging.current?.key === key ? dragging.current.value : latest.current.cues[key]);
  const place = (key: MarkerKey, t: number) => {
    const m = MARKERS.find((x) => x.key === key)!;
    const v = Math.max(0, Math.min(a.duration, t));
    return m.snap ? Math.min(a.duration, snapToBar(a, v)) : Math.round(v * 1000) / 1000;
  };

  // Canvases at their on-screen size; one animation loop draws both.
  useEffect(() => {
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const c of [overview.current, detail.current]) {
        if (!c) continue;
        c.width = Math.max(1, Math.round(c.clientWidth * dpr));
        c.height = Math.max(1, Math.round(c.clientHeight * dpr));
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (overview.current) ro.observe(overview.current);
    if (detail.current) ro.observe(detail.current);
    let raf = 0;
    const loop = () => {
      drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const draw = () => {
    const ph = playhead();
    if (ph !== null && follow.current && !pan.current && !dragging.current) focus.current = ph;
    const o = overview.current?.getContext("2d");
    const d = detail.current?.getContext("2d");
    const w = latest.current.wave;
    const dpr = window.devicePixelRatio || 1;
    const ranges: { from?: number; to?: number; color: string }[] = [
      { from: markerValue("dialogueStart"), to: markerValue("dialogueEnd"), color: "#22d3ee" },
      { from: markerValue("hookStart"), to: markerValue("hookEnd"), color: "#a78bfa" },
    ];
    const paint = (g: CanvasRenderingContext2D, t0: number, t1: number, detailed: boolean) => {
      const W = g.canvas.width;
      const H = g.canvas.height;
      const xOf = (t: number) => ((t - t0) / (t1 - t0)) * W;
      g.clearRect(0, 0, W, H);
      // Drops.
      const bar = barSeconds(a);
      g.fillStyle = "rgba(52,211,153,0.10)";
      for (const s of sections.current) g.fillRect(xOf(a.firstBeat + s.start * bar), 0, xOf(a.firstBeat + s.end * bar) - xOf(a.firstBeat + s.start * bar), H);
      // Marked ranges.
      for (const r of ranges) {
        if (r.from === undefined) continue;
        g.fillStyle = r.color;
        g.globalAlpha = 0.16;
        const x0 = xOf(r.from);
        g.fillRect(x0, 0, (r.to !== undefined ? xOf(r.to) : x0 + 2 * dpr) - x0, H);
        g.globalAlpha = 1;
      }
      // Waveform.
      const mid = H / 2;
      const half = H / 2 - (detailed ? 16 : 3) * dpr;
      if (w) {
        for (let x = 0; x < W; x++) {
          const ta = t0 + (x / W) * (t1 - t0);
          const tb = t0 + ((x + 1) / W) * (t1 - t0);
          const b0 = Math.max(0, Math.floor(ta * w.rate));
          const b1 = Math.min(w.peak.length, Math.max(b0 + 1, Math.ceil(tb * w.rate)));
          let p = 0;
          let l = 0;
          for (let b = b0; b < b1; b++) {
            if (w.peak[b] > p) p = w.peak[b];
            if (w.low[b] > l) l = w.low[b];
          }
          g.fillStyle = "rgba(242,242,247,0.45)";
          g.fillRect(x, mid - (p / 255) * half, 1, (2 * p * half) / 255);
          g.fillStyle = "#7c5cff";
          g.fillRect(x, mid - (l / 255) * half, 1, (2 * l * half) / 255);
        }
      } else if (a.barLevels) {
        g.fillStyle = "rgba(124,92,255,0.5)";
        a.barLevels.forEach((lv, i) => {
          const x0 = xOf(a.firstBeat + i * bar);
          g.fillRect(x0, mid - lv * half, Math.max(1, xOf(a.firstBeat + (i + 1) * bar) - x0 - dpr), 2 * lv * half);
        });
      }
      // Beat grid (detail) / bar grid every 8 bars (overview).
      g.font = `${10 * dpr}px ui-monospace, monospace`;
      g.textBaseline = "top";
      const step = detailed ? 60 / a.bpm : 8 * bar;
      for (let k = Math.ceil((t0 - a.firstBeat) / step); a.firstBeat + k * step <= t1; k++) {
        const t = a.firstBeat + k * step;
        const x = Math.round(xOf(t));
        const barIndex = Math.round((t - a.firstBeat) / bar);
        const downbeat = !detailed || Math.abs((t - a.firstBeat) / bar - barIndex) < 1e-6;
        g.fillStyle = downbeat ? "rgba(242,242,247,0.45)" : "rgba(242,242,247,0.14)";
        g.fillRect(x, 0, dpr, H);
        if (detailed && downbeat && barIndex >= 0) {
          g.fillStyle = "rgba(242,242,247,0.7)";
          g.fillText(String(barIndex + 1), x + 3 * dpr, 2 * dpr);
        }
      }
      // Markers with handles and tags.
      for (const m of MARKERS) {
        const v = markerValue(m.key);
        if (v === undefined) continue;
        const x = xOf(v);
        if (x < -20 || x > W + 20) continue;
        g.fillStyle = m.color;
        g.fillRect(x - dpr, 0, 2 * dpr, H);
        if (detailed) {
          g.fillRect(x - 6 * dpr, H - 14 * dpr, 12 * dpr, 14 * dpr);
          g.fillStyle = "#07070b";
          g.textBaseline = "bottom";
          g.fillText(m.tag, x - 5 * dpr, H - 2 * dpr);
          g.textBaseline = "top";
        }
      }
      // Cursor and playhead.
      const c = latest.current.cursor;
      if (c !== null) {
        g.fillStyle = "#fbbf24";
        g.fillRect(xOf(c) - dpr, 0, 2 * dpr, H);
      }
      if (ph !== null) {
        g.fillStyle = "#ffffff";
        g.fillRect(xOf(ph) - dpr, 0, 2 * dpr, H);
      }
    };
    if (o) {
      paint(o, 0, a.duration, false);
      // Where the zoomed view looks.
      const W = o.canvas.width;
      o.strokeStyle = "#fbbf24";
      o.lineWidth = dpr;
      o.strokeRect((viewStart() / a.duration) * W, 0.5 * dpr, (span() / a.duration) * W, o.canvas.height - dpr);
    }
    if (d) paint(d, viewStart(), viewStart() + span(), true);
  };

  // The latest props for the event handlers and the animation loop (kept current after every render).
  useEffect(() => {
    latest.current = { cues: track.cues ?? {}, zoom, cursor, wave };
    drawRef.current = draw;
  });

  const timeAt = (c: HTMLCanvasElement, clientX: number, whole: boolean) => {
    const box = c.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return whole ? f * a.duration : viewStart() + f * span();
  };

  // Overview: point (or drag) to look there; double-click to listen.
  const onOverview = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    if (e.buttons === 0 && e.type !== "pointerdown") return;
    follow.current = false;
    focus.current = timeAt(e.currentTarget, e.clientX, true);
  };

  // Detail: drag a marker, drag the waveform to scroll, click to put the cursor there and listen.
  const onDetailDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    c.setPointerCapture(e.pointerId);
    const box = c.getBoundingClientRect();
    const hit = MARKERS.map((m) => ({ m, v: latest.current.cues[m.key] }))
      .filter((h): h is { m: (typeof MARKERS)[number]; v: number } => h.v !== undefined)
      .map((h) => ({ ...h, dx: Math.abs(((h.v - viewStart()) / span()) * box.width - (e.clientX - box.left)) }))
      .filter((h) => h.dx <= HIT_PX)
      .sort((x, y) => x.dx - y.dx)[0];
    follow.current = false;
    if (hit) dragging.current = { key: hit.m.key, value: hit.v };
    else pan.current = { x: e.clientX, focus: focus.current, moved: false };
  };
  const onDetailMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    if (dragging.current) {
      dragging.current.value = place(dragging.current.key, timeAt(c, e.clientX, false));
    } else if (pan.current) {
      const dx = e.clientX - pan.current.x;
      if (Math.abs(dx) > 3) pan.current.moved = true;
      focus.current = Math.max(0, Math.min(a.duration, pan.current.focus - (dx / c.getBoundingClientRect().width) * span()));
    }
  };
  const onDetailUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragging.current;
    const p = pan.current;
    dragging.current = null;
    pan.current = null;
    if (d) onSet(d.key, d.value);
    else if (p && !p.moved) {
      const t = Math.round(timeAt(e.currentTarget, e.clientX, false) * 1000) / 1000;
      setCursor(t);
      if (canListen) {
        follow.current = true;
        onListen(t);
      }
    }
  };

  // Trackpad / mouse wheel over the zoomed view scrolls it; a pinch (or Ctrl + wheel) zooms.
  useEffect(() => {
    const c = detail.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      follow.current = false;
      if (e.ctrlKey) {
        setZoom((z) => Math.max(0, Math.min(ZOOMS.length - 1, z + (e.deltaY > 0 ? 1 : -1))));
        return;
      }
      const px = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      focus.current = Math.max(0, Math.min(a.duration, focus.current + (px / c.clientWidth) * span()));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [a.duration]);

  return (
    <div className="mb-4 space-y-2" role="group" aria-label="Song waveform">
      <canvas
        ref={overview}
        className="h-14 w-full cursor-pointer rounded-lg bg-[#07070b]"
        aria-label="Whole song: click to look there, double-click to listen"
        onPointerDown={onOverview}
        onPointerMove={onOverview}
        onDoubleClick={(e) => canListen && onListen(timeAt(e.currentTarget, e.clientX, true))}
      />
      <canvas
        ref={detail}
        className="h-36 w-full cursor-grab touch-none rounded-lg bg-[#07070b] active:cursor-grabbing"
        aria-label="Zoomed view: drag a marker to move it, drag the waveform to scroll, click to put the cursor there and listen"
        data-testid="marker-detail"
        onPointerDown={onDetailDown}
        onPointerMove={onDetailMove}
        onPointerUp={onDetailUp}
        onPointerCancel={onDetailUp}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <button type="button" className="btn h-8 w-8 px-0" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)} aria-label="Zoom out">
            −
          </button>
          <span className="w-12 text-center font-mono text-xs text-muted">{ZOOMS[zoom]} s</span>
          <button type="button" className="btn h-8 w-8 px-0" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} aria-label="Zoom in">
            +
          </button>
        </div>
        <span className="text-muted">
          Cursor <span className="font-mono text-foreground" data-testid="marker-cursor">{cursor === null ? "—" : clock(cursor)}</span>
        </span>
        <span className="mx-1 text-muted">· Set here:</span>
        {MARKERS.map((m) => (
          <button
            key={m.key}
            type="button"
            className="btn px-2.5 py-1 text-xs"
            disabled={cursor === null}
            onClick={() => cursor !== null && onSet(m.key, place(m.key, cursor))}
            style={{ borderColor: m.color }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {!wave && <p className="text-xs text-muted">Preparing the waveform… (showing one block per bar meanwhile)</p>}
    </div>
  );
}
