"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drops, FULL_LEVEL } from "@/lib/analysis/structure";
import { GridPreview } from "@/lib/library/preview";
import type { Track, TrackFlag } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { useSession } from "@/store/session";

const CAMELOT = [...Array.from({ length: 12 }, (_, i) => `${i + 1}A`), ...Array.from({ length: 12 }, (_, i) => `${i + 1}B`)];

/**
 * Admin fixes for one track: never play / favourite, crates, drop detection,
 * beat grid (checked by ear with a click track) and key. Fixes survive
 * re-analysis.
 */
export function TrackEditor({ trackId, crates, onClose }: { trackId: string; crates: string[]; onClose: () => void }) {
  const track = useLibrary((s) => s.tracks[trackId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!track) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <h2 id="editor-title" className="truncate text-xl font-semibold">
              {track.title}
            </h2>
            <p className="truncate text-sm text-muted">
              {track.artist || "Unknown artist"} · {track.path.replace(/^session:/, "")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn">
            Done
          </button>
        </header>
        <div className="flex flex-col gap-6 overflow-auto px-6 py-5">
          <FlagSection track={track} />
          <CrateSection track={track} crates={crates} />
          {track.analysis?.barLevels && <DropSection track={track} />}
          {track.analysis && <GridSection track={track} />}
          {track.analysis && <KeySection track={track} />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-medium uppercase tracking-wider text-muted">{title}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function FlagSection({ track }: { track: Track }) {
  const setFlag = useLibrary((s) => s.setFlag);
  const options: [TrackFlag | undefined, string][] = [
    ["favourite", "★ Favourite"],
    [undefined, "Normal"],
    ["ban", "⛔ Never play"],
  ];
  return (
    <Section title="Playing" hint="Favourites are picked a little more often. Never-play tracks are skipped, even in the request picker.">
      <div className="flex gap-2" role="radiogroup" aria-label="Playing">
        {options.map(([flag, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={track.flag === flag}
            onClick={() => setFlag(track.id, flag)}
            className={`rounded-xl border px-4 py-2 text-sm ${track.flag === flag ? "border-accent bg-accent/20" : "border-border bg-surface-2"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function CrateSection({ track, crates }: { track: Track; crates: string[] }) {
  const setCrates = useLibrary((s) => s.setCrates);
  const [draft, setDraft] = useState("");
  const mine = track.crates ?? [];
  const add = () => {
    if (!draft.trim()) return;
    void setCrates(track.id, [...mine, draft]);
    setDraft("");
  };
  return (
    <Section title="Crates" hint="Group tracks (e.g. Bollywood, Friday). A mood can be limited to some crates on the Moods page.">
      <div className="flex flex-wrap items-center gap-2">
        {mine.map((c) => (
          <span key={c} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
            {c}
            <button
              type="button"
              aria-label={`Remove from ${c}`}
              onClick={() => setCrates(track.id, mine.filter((x) => x !== c))}
              className="rounded-full px-2 text-muted hover:text-foreground"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          list="crate-names"
          placeholder="Add to crate"
          aria-label="Add to crate"
          className="h-9 w-44 rounded-lg border border-border bg-surface-2 px-3 text-sm outline-none focus:border-accent"
        />
        <datalist id="crate-names">
          {crates.filter((c) => !mine.includes(c)).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button type="button" className="btn" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </Section>
  );
}

function DropSection({ track }: { track: Track }) {
  const setOverrides = useLibrary((s) => s.setOverrides);
  const a = track.analysis!;
  const levels = a.barLevels!;
  const saved = a.fullLevel ?? FULL_LEVEL;
  const [level, setLevel] = useState(saved);
  const found = useMemo(() => drops(levels, level), [levels, level]);
  const inDrop = useMemo(() => {
    const set = new Set<number>();
    for (const d of found) for (let b = d.start; b < d.end; b++) set.add(b);
    return set;
  }, [found]);
  return (
    <Section
      title="Drops"
      hint="Highlighted bars are drops (the full sections after a breakdown); the auto-DJ mixes out when a track breaks down after one. Raise the threshold if breakdowns that keep some bass are missed; lower it if a quiet intro is mistaken for a breakdown."
    >
      <svg viewBox={`0 0 ${levels.length} 40`} preserveAspectRatio="none" className="h-14 w-full rounded-lg bg-black/40" aria-hidden>
        {levels.map((l, b) => (
          <rect key={b} x={b + 0.1} y={40 - Math.max(1, l * 38)} width={0.8} height={Math.max(1, l * 38)} fill={inDrop.has(b) ? "var(--accent)" : "#4b4b63"} />
        ))}
        <line x1="0" x2={levels.length} y1={40 - level * 38} y2={40 - level * 38} stroke="var(--warn)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-3 text-sm">
          Threshold
          <input
            type="range"
            min={0.1}
            max={0.7}
            step={0.05}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="w-48 accent-accent"
            aria-label="Drop threshold"
          />
          <span className="w-10 font-mono">{level.toFixed(2)}</span>
        </label>
        <span className="text-sm text-muted">
          {found.length} drop{found.length === 1 ? "" : "s"} found
        </span>
        <button type="button" className="btn-primary" disabled={level === saved} onClick={() => setOverrides(track.id, { fullLevel: level })}>
          Save
        </button>
        <button
          type="button"
          className="btn"
          disabled={track.overrides?.fullLevel === undefined}
          onClick={() => {
            setLevel(FULL_LEVEL);
            void setOverrides(track.id, { fullLevel: null });
          }}
        >
          Reset
        </button>
      </div>
    </Section>
  );
}

function GridSection({ track }: { track: Track }) {
  const setOverrides = useLibrary((s) => s.setOverrides);
  const getFile = useLibrary((s) => s.getFile);
  const boothPlaying = useSession((s) => s.status.playing);
  const a = track.analysis!;
  const [bpm, setBpm] = useState(a.bpm);
  const [firstBeat, setFirstBeat] = useState(a.firstBeat);
  const [busy, setBusy] = useState<"listen" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<GridPreview | null>(null);
  useEffect(() => () => void preview.current?.close(), []);

  const beat = 60 / bpm;
  const changed = Math.abs(bpm - a.bpm) > 1e-6 || Math.abs(firstBeat - a.firstBeat) > 1e-6;
  const firstDrop = a.barLevels ? drops(a.barLevels, a.fullLevel)[0] : undefined;
  // Listen where the beat is clearest: the first drop, else half a minute in.
  const from = firstDrop ? a.firstBeat + firstDrop.start * (240 / a.bpm) : Math.min(30, a.duration / 3);
  const nudge = (sec: number) => setFirstBeat((f) => Math.max(0, Math.round((f + sec) * 1000) / 1000));

  const listen = async () => {
    if (busy === "listen") {
      preview.current?.stop();
      setBusy(null);
      return;
    }
    setError(null);
    setBusy("listen");
    try {
      preview.current ??= new GridPreview();
      preview.current.onEnded = () => setBusy(null);
      await preview.current.play(await getFile(track), { bpm, firstBeat }, from);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play the track");
      setBusy(null);
    }
  };

  const apply = async () => {
    preview.current?.stop();
    setError(null);
    setBusy("apply");
    try {
      await setOverrides(track.id, { bpm, firstBeat });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-analyse the track");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Beat grid"
      hint="Listen: the clicks should land on the kicks, with the high click on beat 1 of each bar. Fix the BPM first, then nudge the first beat until it locks."
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            BPM
            <input
              type="number"
              step={0.01}
              min={60}
              max={200}
              value={Math.round(bpm * 100) / 100}
              onChange={(e) => Number(e.target.value) > 0 && setBpm(Number(e.target.value))}
              className="h-9 w-24 rounded-lg border border-border bg-surface-2 px-2 font-mono outline-none focus:border-accent"
              aria-label="BPM"
            />
          </label>
          <button type="button" className="btn" onClick={() => setBpm((b) => b / 2)}>
            ÷2
          </button>
          <button type="button" className="btn" onClick={() => setBpm((b) => b * 2)}>
            ×2
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">
            First beat <span className="font-mono">{firstBeat.toFixed(3)} s</span>
          </span>
          <button type="button" className="btn" onClick={() => nudge(-beat)} aria-label="One beat earlier">
            −1 beat
          </button>
          <button type="button" className="btn" onClick={() => nudge(-0.01)} aria-label="10 ms earlier">
            −10 ms
          </button>
          <button type="button" className="btn" onClick={() => nudge(0.01)} aria-label="10 ms later">
            +10 ms
          </button>
          <button type="button" className="btn" onClick={() => nudge(beat)} aria-label="One beat later">
            +1 beat
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={boothPlaying || busy === "apply"} onClick={listen}>
          {busy === "listen" ? "Stop" : "Listen with clicks"}
        </button>
        <button type="button" className="btn-primary" disabled={!changed || busy !== null} onClick={apply}>
          {busy === "apply" ? "Re-analysing…" : "Apply grid"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!track.overrides?.bpm || busy !== null}
          onClick={async () => {
            setBusy("apply");
            await setOverrides(track.id, { bpm: null, firstBeat: null }).finally(() => setBusy(null));
            const t = useLibrary.getState().tracks[track.id]?.analysis;
            if (t) {
              setBpm(t.bpm);
              setFirstBeat(t.firstBeat);
            }
          }}
        >
          Back to detected
        </button>
        {boothPlaying && <span className="text-sm text-warn">Stop the set to listen — previews play through the club speakers.</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>
    </Section>
  );
}

function KeySection({ track }: { track: Track }) {
  const setOverrides = useLibrary((s) => s.setOverrides);
  const source = track.keySource === "manual" ? "set by hand" : track.keySource === "audio" ? "detected from the audio" : track.keySource === "tag" ? "from the file's tag" : "unknown";
  return (
    <Section title="Key" hint={`Camelot key used for harmonic mixing — currently ${track.camelot ?? "unknown"} (${source}).`}>
      <select
        value={track.overrides?.key ?? ""}
        onChange={(e) => setOverrides(track.id, { key: e.target.value || null })}
        aria-label="Key"
        className="h-10 rounded-lg border border-border bg-surface-2 px-3"
      >
        <option value="">Automatic (tag, else detected)</option>
        {CAMELOT.map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
    </Section>
  );
}
