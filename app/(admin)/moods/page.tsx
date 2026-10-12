import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { MOODS } from "@/lib/dj/moods";

export const metadata: Metadata = { title: "Moods · AI DJ Mixer" };

// Read-only view of the mood presets. Edit them in lib/dj/moods.ts.
export default function MoodsPage() {
  return (
    <>
      <Nav active="/moods" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <p className="mb-4 text-sm text-muted">
          Each mood sets the tempo band, energy band, preferred genres and blend length the auto-DJ aims for.
        </p>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Mood</th>
                <th className="px-3 py-2 font-medium">BPM</th>
                <th className="px-3 py-2 font-medium">Energy</th>
                <th className="px-3 py-2 font-medium">Blend</th>
                <th className="px-5 py-2 font-medium">Genres</th>
              </tr>
            </thead>
            <tbody>
              {MOODS.map((m) => (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="px-5 py-3">
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-muted">{m.description}</p>
                  </td>
                  <td className="px-3 py-3 font-mono">{m.bpm[0]}–{m.bpm[1]}</td>
                  <td className="px-3 py-3 font-mono">{m.energy[0]}–{m.energy[1]}</td>
                  <td className="px-3 py-3 font-mono">{m.blendBars} bars</td>
                  <td className="px-5 py-3 text-muted">{m.genres.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
