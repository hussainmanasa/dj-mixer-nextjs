"use client";

import { useEffect, useMemo, useState } from "react";
import { canPickFolders } from "@/lib/library/scan";
import { MAX_DECKS, MIN_DECKS } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { AudioOutputs } from "./AudioOutputs";
import { TrackTable } from "./TrackTable";

const DECK_HELP: Record<number, string> = {
  2: "Standard A/B mixing. Any modern laptop.",
  3: "Adds a standby deck with a track ready for instant recovery. Mid-range laptop or mini-PC.",
  4: "Reserves a fourth deck for layered blends. Stronger CPU, 16 GB RAM suggested.",
};

export function LibraryManager() {
  const s = useLibrary();
  const { hydrate } = s;
  useEffect(() => {
    // Analyse anything new or analysed by an older version once the folder is readable.
    void hydrate().then(() => {
      const lib = useLibrary.getState();
      if (lib.folderState === "ready") void lib.analyzePending();
    });
  }, [hydrate]);

  const [supported, setSupported] = useState(true);
  useEffect(() => {
    // Checked after mount: the server render can't know the browser.
    const id = requestAnimationFrame(() => setSupported(canPickFolders()));
    return () => cancelAnimationFrame(id);
  }, []);

  const list = useMemo(
    () => Object.values(s.tracks).sort((a, b) => a.path.localeCompare(b.path)),
    [s.tracks],
  );
  const counts = useMemo(() => {
    const c = { ready: 0, pending: 0, error: 0 };
    for (const t of list) c[t.status]++;
    return c;
  }, [list]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      {!supported && (
        <p className="rounded-xl border border-bad/40 bg-bad/10 px-5 py-4">
          This browser can&apos;t open folders. Use Chrome or Edge on a computer for the booth.
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 md:col-span-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Music folder</h2>
          <p className="mt-2 text-lg">
            {s.folder ? s.folder.name : "Not connected"}
            {s.folderState === "needs-permission" && <span className="ml-2 text-sm text-warn">(access needed)</span>}
          </p>
          <p className="mt-1 text-sm text-muted">
            Use tracks your club is licensed to play in public. Files stay on this computer; only their analysis is
            saved in the browser.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => s.chooseFolder()} disabled={!supported || s.scanning} className="btn-primary">
              {s.folder ? "Choose another folder" : "Choose music folder"}
            </button>
            {s.folderState === "needs-permission" && (
              <button type="button" onClick={async () => { if (await s.reconnect()) await s.rescan(); }} className="btn">
                Allow access
              </button>
            )}
            {s.folderState === "ready" && (
              <button type="button" onClick={() => s.rescan()} disabled={s.scanning} className="btn">
                {s.scanning ? "Scanning…" : "Rescan for new files"}
              </button>
            )}
            <label className="btn cursor-pointer">
              Add files (this session only)
              <input
                type="file"
                // Songs, plus the folder's ai-dj-mixer-settings.json (it brings their analysis and edits).
                accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.json,application/json"
                multiple
                className="sr-only"
                data-testid="session-files"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void s.addSessionFiles(files);
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={counts.ready === 0}
              onClick={() => s.downloadSettingsFile()}
              title="Settings, song edits and analysis as ai-dj-mixer-settings.json — put it beside the music (e.g. on the USB drive)"
            >
              Download analysis file
            </button>
            {counts.error > 0 && (
              <button type="button" onClick={() => s.retryFailed()} className="btn">
                Retry {counts.error} failed
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            Playing straight from a USB drive (an iPad, Safari): pick the songs with <strong>Add files (this session only)</strong>
            — and pick the drive&apos;s <span className="font-mono">ai-dj-mixer-settings.json</span> with them, so songs analysed
            before are ready at once. This device also remembers songs it has analysed. <strong>Download analysis file</strong>{" "}
            saves that file to put on the drive.
          </p>
          {s.error && <p className="mt-3 text-sm text-bad">{s.error}</p>}
          {s.folder && s.folderState === "ready" && <SettingsFileNote />}
          {s.analysis && (
            <div className="mt-4">
              <p className="text-sm text-muted">
                Analysing {s.analysis.done + 1} of {s.analysis.total}: {s.analysis.current}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(s.analysis.done / Math.max(1, s.analysis.total)) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Decks</h2>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Number of decks">
            {Array.from({ length: MAX_DECKS - MIN_DECKS + 1 }, (_, i) => MIN_DECKS + i).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={s.settings.deckCount === n}
                onClick={() => s.setDeckCount(n)}
                className={`h-12 w-12 rounded-xl border text-lg font-semibold ${
                  s.settings.deckCount === n ? "border-accent bg-accent/20" : "border-border bg-surface-2"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">{DECK_HELP[s.settings.deckCount]}</p>
          <p className="mt-1 text-xs text-muted">Applies straight away, also during a set: a deck that&apos;s playing or cued is removed once it&apos;s free.</p>

          <h2 className="mt-6 text-sm font-medium uppercase tracking-wider text-muted">Key lock (beta)</h2>
          <label className="mt-3 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={s.settings.keyLock}
              onChange={(e) => s.setKeyLock(e.target.checked)}
              className="h-6 w-6 accent-accent"
            />
            <span className="text-sm">Keep tracks in their original key while matching tempo</span>
          </label>
          <p className="mt-2 text-sm text-muted">
            Without it, a track sped up 5% also plays 5% higher. With it, the key stays put, at the cost of a slightly
            softer sound on big tempo changes. Listen on the venue system before using it on a busy night.
          </p>
          <p className="mt-1 text-xs text-muted">Switches straight away, also during a set (a very short smear as it switches).</p>
        </div>
      </section>

      <AudioOutputs />

      <TrackTable />
    </main>
  );
}

/** m/d hh:mm in the venue's locale. */
function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The settings file kept in the music folder: settings and every song's edits
 * travel with the music to any computer, and are read back whenever the folder
 * is opened or rescanned.
 */
function SettingsFileNote() {
  const f = useLibrary((s) => s.settingsFile);
  const enable = useLibrary((s) => s.enableSettingsFile);
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2/60 p-3 text-sm" role="status" aria-label="Settings file">
      {f.status === "saved" && (
        <p>
          Settings, song edits and analysis are saved in the music folder as <span className="font-mono">{f.name}</span>
          {f.savedAt ? ` · ${when(f.savedAt)}` : ""} — open this folder on any computer to get them back.
        </p>
      )}
      {f.status === "readonly" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1">
            {f.name ? (
              <>
                Read settings from <span className="font-mono">{f.name}</span> in the music folder. Allow the app to update it so your changes are
                kept there too.
              </>
            ) : (
              <>
                Save the app&apos;s settings, every song&apos;s edits and its analysis in the music folder, so they go wherever the music
                goes — another computer or an iPad needn&apos;t analyse it again.
              </>
            )}
          </p>
          <button type="button" className="btn-primary" onClick={() => void enable()}>
            Save settings in the music folder
          </button>
        </div>
      )}
      {f.status === "error" && <p className="text-bad">Couldn&apos;t use the settings file: {f.error}</p>}
      {f.imported && (
        <p className="mt-1 text-good">
          Imported settings{f.imported.songs ? ` and edits for ${f.imported.songs} song${f.imported.songs === 1 ? "" : "s"}` : ""} from{" "}
          <span className="font-mono">{f.imported.from}</span>
          {f.imported.savedAt ? ` (saved ${when(f.imported.savedAt)})` : ""}.
        </p>
      )}
    </div>
  );
}
