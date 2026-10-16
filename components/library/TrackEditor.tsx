"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { drops, FULL_LEVEL } from "@/lib/analysis/structure";
import { dialogueOf, hookOf, snapToBar, validateCues } from "@/lib/dj/cues";
import { MarkerWaveform } from "./MarkerWaveform";
import { barSeconds, dropCue } from "@/lib/dj/mixpoints";
import type { GridPreview } from "@/lib/library/preview";
import type { Track, TrackCues, TrackFlag } from "@/lib/types";
import { previewIsSeparate, useLibrary } from "@/store/library";
import { usePreview as usePreviewStore } from "@/store/preview";
import { useSession } from "@/store/session";

const CAMELOT = [...Array.from({ length: 12 }, (_, i) => `${i + 1}A`), ...Array.from({ length: 12 }, (_, i) => `${i + 1}B`)];

/** One preview player per editor, so only one thing plays at a time. */
interface PreviewApi {
  /** What is playing: "grid", "cues", "dialogue" or null (only once audio has started). */
  playing: string | null;
  /** A song is being loaded for a preview. */
  loading: boolean;
  play: (tag: string, run: (p: GridPreview) => Promise<void>) => Promise<void>;
  stop: () => void;
  position: () => number | null;
  error: string | null;
}
const PreviewCtx = createContext<PreviewApi | null>(null);
const usePreview = () => useContext(PreviewCtx)!;

function usePreviewApi(): PreviewApi {
  // The shared preview player (also used by the booth's Cue and the picker).
  const api = usePreviewStore();
  // Leaving the editor stops its own preview.
  useEffect(
    () => () => {
      const { playing, stop } = usePreviewStore.getState();
      if (playing === "grid" || playing === "cues" || playing === "dialogue") stop();
    },
    [],
  );
  return api;
}

/** Previews would be heard on the club speakers: a set is playing and no separate preview output is chosen. */
function usePreviewBlocked(): boolean {
  const playing = useSession((s) => s.status.playing);
  const separate = useLibrary((s) => previewIsSeparate(s.settings));
  return playing && !separate;
}

/**
 * Admin fixes for one track: never play / favourite, crates, song markers,
 * drop detection, beat grid (checked by ear with a click track) and key.
 * Fixes survive re-analysis.
 */
export function TrackEditor({ trackId, crates, onClose }: { trackId: string; crates: string[]; onClose: () => void }) {
  const track = useLibrary((s) => s.tracks[trackId]);
  const preview = usePreviewApi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!track) return null;
  return (
    <PreviewCtx.Provider value={preview}>
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
          {track.analysis && <CueSection track={track} />}
          {track.analysis?.barLevels && <DropSection track={track} />}
          {track.analysis && <GridSection track={track} />}
          {track.analysis && <KeySection track={track} />}
        </div>
      </div>
    </div>
    </PreviewCtx.Provider>
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

const MARKERS: { key: keyof TrackCues; label: string; snap: boolean }[] = [
  { key: "dialogueStart", label: "Dialogue starts", snap: false },
  { key: "dialogueEnd", label: "Dialogue ends", snap: false },
  { key: "hookStart", label: "Hook starts", snap: true },
  { key: "hookEnd", label: "Hook ends", snap: true },
  { key: "start", label: "Cue in", snap: true },
  { key: "end", label: "Cue out", snap: true },
];

/** m:ss.s */
function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, "0")}`;
}

function CueSection({ track }: { track: Track }) {
  const setCues = useLibrary((s) => s.setCues);
  const setSavedLoops = useLibrary((s) => s.setSavedLoops);
  const getFile = useLibrary((s) => s.getFile);
  const boothPlaying = usePreviewBlocked();
  const preview = usePreview();
  const a = track.analysis!;
  const cues = track.cues ?? {};
  const bar = barSeconds(a);
  const dialogue = dialogueOf(cues);
  const errors = validateCues(cues, a.duration);

  // Playhead, written straight to the DOM while previewing.
  const head = useRef<HTMLSpanElement>(null);
  const { playing, position } = preview;
  useEffect(() => {
    if (!playing) {
      if (head.current) head.current.textContent = "—";
      return;
    }
    let raf = 0;
    const tick = () => {
      const p = position();
      if (head.current) head.current.textContent = p === null ? "—" : clock(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, position]);

  const playFrom = async (from: number) => preview.play("cues", async (p) => p.playFrom(await getFile(track), Math.max(0, from)));
  const places: [string, number | undefined][] = [
    ["Song start", 0],
    ["Dialogue", cues.dialogueStart],
    ["Hook", cues.hookStart],
    ["Drop", dropCue(a)],
  ];

  const mark = (key: keyof TrackCues, snap: boolean) => {
    const p = preview.position();
    if (p !== null) void setCues(track.id, { [key]: snap ? snapToBar(a, p) : p });
  };
  const nudge = (key: keyof TrackCues, delta: number) => {
    const v = cues[key];
    if (v !== undefined) void setCues(track.id, { [key]: Math.max(0, Math.min(a.duration, v + delta)) });
  };

  return (
    <Section
      title="Song markers"
      hint="Drag a marker's handle on the waveform, or click to put the cursor there (and listen) and press Set here — or play the song and press Mark now. Cue in is where the song starts when the auto-DJ brings it in; cue out is where it hands over to the next song (instead of its own guess). The dialogue plays before the song drops in (Drop and Desi Night); the hook is what Desi Night opens with. Cue in, cue out and the hook snap to the bar."
    >
      <MarkerWaveform
        track={track}
        onSet={(key, seconds) => void setCues(track.id, { [key]: seconds })}
        onLoops={(loops) => void setSavedLoops(track.id, loops)}
        onListen={(from) => void playFrom(from)}
        playhead={() => {
          // Only this editor's previews (not a booth Cue or a picker preview playing another song).
          const p = usePreviewStore.getState();
          return p.playing && !/^(cue|pick):/.test(p.playing) ? p.position() : null;
        }}
        canListen={!boothPlaying && !preview.loading}
      />
      <div className="flex flex-wrap items-center gap-2">
        {places.map(([label, at]) => (
          <button key={label} type="button" className="btn" disabled={boothPlaying || preview.loading || at === undefined} onClick={() => playFrom(at!)}>
            ▶ {label}
          </button>
        ))}
        <button type="button" className="btn" disabled={!preview.playing} onClick={preview.stop}>
          ■ Stop
        </button>
        <span className="ml-2 text-sm text-muted">
          Playhead <span ref={head} className="font-mono text-foreground">—</span>
        </span>
      </div>
      {boothPlaying && <p className="mt-2 text-sm text-warn">A set is playing: choose a separate preview output (Audio outputs, above) to listen without the club hearing it.</p>}

      <Suggestions track={track} />

      <table className="mt-3 w-full text-sm">
        <tbody>
          {MARKERS.map(({ key, label, snap }) => (
            <tr key={key} className="border-t border-border">
              <td className="py-2 pr-3 text-muted">{label}</td>
              <td className="w-20 py-2 font-mono">{cues[key] === undefined ? "—" : clock(cues[key]!)}</td>
              <td className="py-2 text-right">
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" className="btn" disabled={!preview.playing} onClick={() => mark(key, snap)} aria-label={`Mark ${label.toLowerCase()} now`}>
                    Mark now
                  </button>
                  <button type="button" className="btn" disabled={cues[key] === undefined} onClick={() => nudge(key, snap ? -bar : -0.1)} aria-label={`${label} earlier`}>
                    {snap ? "−1 bar" : "−0.1 s"}
                  </button>
                  <button type="button" className="btn" disabled={cues[key] === undefined} onClick={() => nudge(key, snap ? bar : 0.1)} aria-label={`${label} later`}>
                    {snap ? "+1 bar" : "+0.1 s"}
                  </button>
                  <button type="button" className="btn" disabled={cues[key] === undefined} onClick={() => setCues(track.id, { [key]: null })} aria-label={`Clear ${label.toLowerCase()}`}>
                    Clear
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!dialogue || boothPlaying || preview.loading}
          onClick={() =>
            preview.playing === "dialogue"
              ? preview.stop()
              : preview.play("dialogue", async (p) =>
                  p.playFrom(await getFile(track), dialogue!.start, { jump: { at: dialogue!.end, to: dropCue(a), after: 8 * bar } }),
                )
          }
        >
          {preview.playing === "dialogue" ? "■ Stop" : "▶ Try dialogue → drop"}
        </button>
        {!dialogue && <span className="text-sm text-muted">Mark a dialogue to hear how it drops into the song.</span>}
        {preview.error && <span className="text-sm text-bad">{preview.error}</span>}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 text-sm text-bad">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Hook and dialogue the analysis suggests: listen, then Use to set the markers. */
function Suggestions({ track }: { track: Track }) {
  const setCues = useLibrary((s) => s.setCues);
  const getFile = useLibrary((s) => s.getFile);
  const boothPlaying = usePreviewBlocked();
  const preview = usePreview();
  const a = track.analysis!;
  if (a.suggestedHook === undefined && a.suggestedDialogue === undefined) {
    return <p className="mt-3 text-sm text-muted">Suggestions appear once this song has been re-analysed.</p>;
  }
  const cues = track.cues ?? {};
  const rows = [
    {
      label: "Hook",
      range: a.suggestedHook,
      used: cues.hookStart === a.suggestedHook?.start && cues.hookEnd === a.suggestedHook?.end,
      use: (r: { start: number; end: number }) => setCues(track.id, { hookStart: r.start, hookEnd: r.end }),
      // Listen to the hook itself.
      listen: async (r: { start: number; end: number }) =>
        preview.play("cues", async (p) => p.playFrom(await getFile(track), r.start, { length: r.end - r.start })),
    },
    {
      label: "Dialogue",
      range: a.suggestedDialogue,
      used: cues.dialogueStart === a.suggestedDialogue?.start && cues.dialogueEnd === a.suggestedDialogue?.end,
      use: (r: { start: number; end: number }) => setCues(track.id, { dialogueStart: r.start, dialogueEnd: r.end }),
      // Listen to it as it would play: the dialogue, then the drop.
      listen: async (r: { start: number; end: number }) =>
        preview.play("dialogue", async (p) =>
          p.playFrom(await getFile(track), r.start, { jump: { at: r.end, to: dropCue(a), after: 8 * barSeconds(a) } }),
        ),
    },
  ];
  return (
    <div className="mt-3 rounded-xl border border-dashed border-border p-3">
      <p className="text-xs uppercase tracking-wider text-muted">Suggested by the analysis — check by ear</p>
      {rows.map(({ label, range, used, use, listen }) => (
        <div key={label} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="w-20 text-muted">{label}</span>
          {range ? (
            <>
              <span className="font-mono">
                {clock(range.start)} – {clock(range.end)}
              </span>
              <span className="text-xs text-muted">{Math.round(range.confidence * 100)}% sure</span>
              <button type="button" className="btn" disabled={boothPlaying || preview.loading} onClick={() => listen(range)} aria-label={`Listen to the suggested ${label.toLowerCase()}`}>
                ▶ Listen
              </button>
              <button type="button" className="btn-primary" disabled={used} onClick={() => use(range)} aria-label={`Use the suggested ${label.toLowerCase()}`}>
                {used ? "In use" : "Use"}
              </button>
            </>
          ) : (
            <span className="text-muted">None found</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DropSection({ track }: { track: Track }) {
  const setOverrides = useLibrary((s) => s.setOverrides);
  const a = track.analysis!;
  const levels = a.barLevels!;
  const saved = a.fullLevel ?? FULL_LEVEL;
  const [level, setLevel] = useState(saved);
  const found = useMemo(() => drops(levels, level), [levels, level]);
  // Marked dialogue / hook, in bars, drawn along the top of the overview.
  const toBar = (t: number) => (t - a.firstBeat) / (240 / a.bpm);
  const marked = [
    { label: "Dialogue", range: dialogueOf(track.cues), color: "var(--warn)" },
    { label: "Hook", range: hookOf(track.cues), color: "var(--good)" },
  ].flatMap((m) => (m.range ? [{ label: m.label, color: m.color, from: toBar(m.range.start), to: toBar(m.range.end) }] : []));
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
        {marked.map((m) => (
          <rect key={m.label} x={m.from} width={Math.max(0.5, m.to - m.from)} y={0} height={4} fill={m.color}>
            <title>{m.label}</title>
          </rect>
        ))}
      </svg>
      {marked.length > 0 && (
        <p className="mt-1 flex gap-4 text-xs text-muted">
          {marked.map((m) => (
            <span key={m.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: m.color }} />
              {m.label}
            </span>
          ))}
        </p>
      )}
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
  const boothPlaying = usePreviewBlocked();
  const a = track.analysis!;
  const [bpm, setBpm] = useState(a.bpm);
  const [firstBeat, setFirstBeat] = useState(a.firstBeat);
  const [busy, setBusy] = useState<"apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview();

  const beat = 60 / bpm;
  const changed = Math.abs(bpm - a.bpm) > 1e-6 || Math.abs(firstBeat - a.firstBeat) > 1e-6;
  const validBpm = bpm >= 60 && bpm <= 200;
  const firstDrop = a.barLevels ? drops(a.barLevels, a.fullLevel)[0] : undefined;
  // Listen where the beat is clearest: the first drop, else half a minute in.
  const from = firstDrop ? a.firstBeat + firstDrop.start * (240 / a.bpm) : Math.min(30, a.duration / 3);
  const nudge = (sec: number) => setFirstBeat((f) => Math.max(0, Math.round((f + sec) * 1000) / 1000));

  const listen = async () => {
    if (preview.playing === "grid") return preview.stop();
    await preview.play("grid", async (p) => p.play(await getFile(track), { bpm, firstBeat }, from));
  };

  const apply = async () => {
    preview.stop();
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
              // Arrows step by 1 BPM from the current value (no `min`, which would snap 126.97 → 127);
              // decimals can still be typed.
              step={1}
              value={Math.round(bpm * 100) / 100}
              onChange={(e) => Number(e.target.value) > 0 && setBpm(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                const delta = e.key === "ArrowUp" ? 1 : -1;
                setBpm((b) => Math.min(200, Math.max(60, Math.round((b + delta) * 100) / 100)));
              }}
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
        <button type="button" className="btn" disabled={boothPlaying || preview.loading || busy === "apply"} onClick={listen}>
          {preview.playing === "grid" ? "Stop" : "Listen with clicks"}
        </button>
        <button type="button" className="btn-primary" disabled={!changed || !validBpm || busy !== null} onClick={apply}>
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
        {boothPlaying && <span className="text-sm text-warn">A set is playing: choose a separate preview output (Audio outputs, above) to listen without the club hearing it.</span>}
        {!validBpm && <span className="text-sm text-bad">BPM must be between 60 and 200.</span>}
        {(error ?? preview.error) && <span className="text-sm text-bad">{error ?? preview.error}</span>}
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
