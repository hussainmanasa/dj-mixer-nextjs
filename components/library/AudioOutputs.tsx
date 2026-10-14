"use client";

import { useCallback, useEffect, useState } from "react";
import { canChooseOutputs, listOutputs, testTone, unlockLabels, type OutputDevice } from "@/lib/audio/outputs";
import { previewIsSeparate, useLibrary } from "@/store/library";
import { useSession } from "@/store/session";

/**
 * Where the sound goes: the club speakers (PA) get the mix; a separate
 * preview / cue output (headphones) gets previews and Cue, so staff can listen
 * ahead during a set without the crowd hearing it.
 */
export function AudioOutputs() {
  const settings = useLibrary((s) => s.settings);
  const setOutputs = useLibrary((s) => s.setOutputs);
  const applyOutput = useSession((s) => s.applyOutput);
  const [supported, setSupported] = useState(true);
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [named, setNamed] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listOutputs();
    setDevices(list);
    setNamed(list.length > 0 && list.every((d) => !/^Output \d+$/.test(d.label)));
  }, []);

  useEffect(() => {
    // Checked after mount: the server render can't know the browser.
    const id = requestAnimationFrame(() => {
      setSupported(canChooseOutputs());
      void refresh();
    });
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelAnimationFrame(id);
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);

  if (!supported) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Audio outputs</h2>
        <p className="mt-2 text-sm text-muted">This browser can&apos;t choose outputs. Use Chrome or Edge to send previews to headphones.</p>
      </section>
    );
  }

  const options = [{ id: "", label: "This computer's default output" }, ...devices];
  const missing = (id: string | null) => id !== null && id !== "" && !devices.some((d) => d.id === id);
  const separate = previewIsSeparate(settings);

  return (
    <section aria-labelledby="outputs-heading" className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="outputs-heading" className="text-sm font-medium uppercase tracking-wider text-muted">
          Audio outputs
        </h2>
        {!named && (
          <button type="button" className="btn" onClick={async () => (await unlockLabels()) && refresh()}>
            Show device names
          </button>
        )}
      </div>
      {!named && (
        <p className="mt-1 text-sm text-muted">
          Chrome only shows device names after you allow microphone access once — nothing is recorded.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <OutputChoice
          label="Club speakers (the mix)"
          hint="Bluetooth speaker or the 3.5 mm jack."
          value={settings.mainOutput}
          options={options}
          missing={missing(settings.mainOutput)}
          onChange={async (id) => {
            await setOutputs({ mainOutput: id });
            await applyOutput();
          }}
        />
        <OutputChoice
          label="Preview & Cue (headphones)"
          hint="USB-C or HDMI. Previews, Cue and the track editor play here."
          value={settings.previewOutput ?? ""}
          options={[{ id: "none", label: "Not set (same as the club speakers)" }, ...options]}
          selected={settings.previewOutput === null ? "none" : settings.previewOutput}
          missing={missing(settings.previewOutput)}
          onChange={(id) => setOutputs({ previewOutput: id === "none" ? null : id })}
        />
      </div>

      {!separate && (
        <p className="mt-3 text-sm text-warn">
          Previews and Cue share the club speakers, so they&apos;re blocked while a set plays. Choose a different preview output to
          listen ahead during a set.
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Bluetooth adds a delay (the booth display waits for it) and can drop out without the app knowing. A wired output is
        safer for a club.
      </p>
    </section>
  );
}

function OutputChoice({
  label,
  hint,
  value,
  selected,
  options,
  missing,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  selected?: string;
  options: OutputDevice[];
  missing: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm">
        <span className="font-medium">{label}</span>
        <select
          value={selected ?? value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-2 px-3"
          aria-label={label}
        >
          {options.map((o) => (
            <option key={o.id || "default"} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {missing && <p className="mt-1 text-xs text-warn">That device isn&apos;t connected — the default output is used until it is.</p>}
      <button type="button" className="btn mt-2" onClick={() => void testTone(value)} aria-label={`Test ${label}`}>
        Test sound
      </button>
    </div>
  );
}
