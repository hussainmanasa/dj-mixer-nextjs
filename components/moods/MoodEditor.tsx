"use client";

import { useEffect, useMemo, useState } from "react";
import { BLEND_BAR_OPTIONS, validateMood } from "@/lib/dj/moods";
import type { Mood } from "@/lib/types";
import { useLibrary, useMoods } from "@/store/library";
import { MOOD_COLOR } from "@/components/booth/theme";

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

/**
 * Edit the mood presets. Changes are saved in this browser and the auto-DJ
 * picks them up at its next decision, even mid-set.
 */
export function MoodEditor() {
  const hydrate = useLibrary((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  const moods = useMoods();
  const overrides = useLibrary((s) => s.settings.moods);
  const tracks = useLibrary((s) => s.tracks);
  const crates = useMemo(() => [...new Set(Object.values(tracks).flatMap((t) => t.crates ?? []))].sort(), [tracks]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <p className="max-w-3xl text-sm text-muted">
        Each mood steers the auto-DJ: the tempo and energy it aims for, how long its blends are, how long each track
        plays, and which crates it picks from. Edits apply from the next transition, even during a set.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {moods.map((m) => (
          // Re-mount on save/reset so the draft starts from the stored mood.
          <MoodCard key={`${m.id}:${JSON.stringify(overrides[m.id] ?? null)}`} mood={m} edited={!!overrides[m.id]} crates={crates} />
        ))}
      </div>
    </main>
  );
}

function MoodCard({ mood, edited, crates }: { mood: Mood; edited: boolean; crates: string[] }) {
  const saveMood = useLibrary((s) => s.saveMood);
  const [draft, setDraft] = useState<Mood>(mood);
  const errors = validateMood(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(mood);
  const set = <K extends keyof Mood>(k: K, v: Mood[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const mid = (draft.bpm[0] + draft.bpm[1]) / 2;
  const maxSec = (draft.maxPlayBars * 240) / mid;

  const num = "h-9 w-20 rounded-lg border border-border bg-surface-2 px-2 font-mono outline-none focus:border-accent";
  const row = "flex flex-wrap items-center gap-2 text-sm";

  return (
    <section aria-label={`${mood.name} mood`} className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <header className="flex items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: MOOD_COLOR[mood.id] }} />
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          aria-label="Name"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:border-border focus:border-accent"
        />
        {edited && <span className="rounded bg-accent/20 px-2 py-0.5 text-xs text-accent">Edited</span>}
      </header>
      <input
        value={draft.description}
        onChange={(e) => set("description", e.target.value)}
        aria-label="Description"
        className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted outline-none focus:border-accent"
      />

      <div className="grid gap-3">
        <label className={row}>
          <span className="w-16 text-muted">BPM</span>
          <input type="number" className={num} value={draft.bpm[0]} onChange={(e) => set("bpm", [Number(e.target.value), draft.bpm[1]])} aria-label="Lowest BPM" />
          –
          <input type="number" className={num} value={draft.bpm[1]} onChange={(e) => set("bpm", [draft.bpm[0], Number(e.target.value)])} aria-label="Highest BPM" />
        </label>
        <label className={row}>
          <span className="w-16 text-muted">Energy</span>
          <input type="number" step={0.05} className={num} value={draft.energy[0]} onChange={(e) => set("energy", [Number(e.target.value), draft.energy[1]])} aria-label="Lowest energy" />
          –
          <input type="number" step={0.05} className={num} value={draft.energy[1]} onChange={(e) => set("energy", [draft.energy[0], Number(e.target.value)])} aria-label="Highest energy" />
        </label>
        <label className={row}>
          <span className="w-16 text-muted">Blend</span>
          <select className={`${num} w-28`} value={draft.blendBars} onChange={(e) => set("blendBars", Number(e.target.value))} aria-label="Blend length">
            {BLEND_BAR_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b} bars
              </option>
            ))}
          </select>
        </label>
        <label className={row}>
          <span className="w-16 text-muted">Leave</span>
          <select className={`${num} w-44`} value={draft.mixOutAfterDrops} onChange={(e) => set("mixOutAfterDrops", Number(e.target.value))} aria-label="Leave after drop">
            {ORDINAL.map((o, i) => (
              <option key={o} value={i + 1}>
                after {o} drop
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={row}>
        <span className="text-muted">Tracks with no breakdowns play at most</span>
        <input type="number" step={8} className={num} value={draft.maxPlayBars} onChange={(e) => set("maxPlayBars", Number(e.target.value))} aria-label="Longest play in bars" />
        <span className="text-muted">
          bars (≈ {Math.floor(maxSec / 60)}:{String(Math.round(maxSec % 60)).padStart(2, "0")})
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={draft.dropSwap} onChange={(e) => set("dropSwap", e.target.checked)} className="mt-0.5 h-5 w-5 accent-accent" />
        <span>
          Drop swaps
          <span className="block text-muted">Bring each next track in on its drop where the current one breaks down, instead of a long blend.</span>
        </span>
      </label>

      <div className="flex flex-col gap-3 rounded-xl border border-border p-3 text-sm">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={!!draft.opener}
            onChange={(e) => set("opener", e.target.checked ? { crates: ["Romantic"], maxBpm: 105 } : undefined)}
            className="mt-0.5 h-5 w-5 accent-accent"
          />
          <span>
            Open the set with a slow song&apos;s hook
            <span className="block text-muted">
              Only when a set starts in this mood: a slow song plays its hook (marked in the Library), then drops into the party.
            </span>
          </span>
        </label>
        {draft.opener && (
          <div className="ml-8 flex flex-col gap-2">
            <label className={row}>
              <span className="text-muted">Opener at most</span>
              <input
                type="number"
                className={num}
                value={draft.opener.maxBpm}
                onChange={(e) => set("opener", { ...draft.opener!, maxBpm: Number(e.target.value) })}
                aria-label="Opener top BPM"
              />
              <span className="text-muted">BPM, from crates</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...crates, ...draft.opener.crates])].sort().map((c) => {
                const on = draft.opener!.crates.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Opener crate ${c}`}
                    onClick={() =>
                      set("opener", { ...draft.opener!, crates: on ? draft.opener!.crates.filter((x) => x !== c) : [...draft.opener!.crates, c] })
                    }
                    className={`rounded-full border px-3 py-1 ${on ? "border-accent bg-accent/20" : "border-border bg-surface-2 text-muted"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={!!draft.holdForDrop} onChange={(e) => set("holdForDrop", e.target.checked || undefined)} className="mt-0.5 h-5 w-5 accent-accent" />
          <span>
            Hold each song until Drop
            <span className="block text-muted">
              Songs play on until staff press Drop (a marked dialogue plays first, then the drop). If nobody does, they mix out near
              their end.
            </span>
          </span>
        </label>
      </div>

      <div className="text-sm">
        <span className="text-muted">Play only from crates</span>
        {crates.length === 0 ? (
          <p className="mt-1 text-muted">No crates yet — add tracks to crates on the Library page.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {crates.map((c) => {
              const on = draft.crates?.includes(c) ?? false;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("crates", on ? draft.crates!.filter((x) => x !== c) : [...(draft.crates ?? []), c])}
                  className={`rounded-full border px-3 py-1 ${on ? "border-accent bg-accent/20" : "border-border bg-surface-2 text-muted"}`}
                >
                  {c}
                </button>
              );
            })}
            <span className="self-center text-xs text-muted">{draft.crates?.length ? "" : "None picked: the whole library"}</span>
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">Genres that count as a match (comma separated)</span>
        <input
          value={draft.genres.join(", ")}
          onChange={(e) => set("genres", e.target.value.split(",").map((g) => g.trim().toLowerCase()).filter(Boolean))}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 outline-none focus:border-accent"
        />
      </label>

      {errors.length > 0 && (
        <ul className="text-sm text-bad">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!changed || errors.length > 0} onClick={() => saveMood(draft, mood.id)}>
          Save
        </button>
        <button type="button" className="btn" disabled={!changed} onClick={() => setDraft(mood)}>
          Undo changes
        </button>
        <button type="button" className="btn ml-auto" disabled={!edited} onClick={() => saveMood(null, mood.id)}>
          Reset to default
        </button>
      </div>
    </section>
  );
}
