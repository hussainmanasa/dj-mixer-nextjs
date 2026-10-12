// Musical key helpers: normalise key tags to Camelot notation and score
// harmonic compatibility between two keys.

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, "B#": 0,
  "C#": 1, DB: 1,
  D: 2,
  "D#": 3, EB: 3,
  E: 4, FB: 4,
  F: 5, "E#": 5,
  "F#": 6, GB: 6,
  G: 7,
  "G#": 8, AB: 8,
  A: 9,
  "A#": 10, BB: 10,
  B: 11, CB: 11,
};

/** Camelot number (1..12) of a major key with the given tonic semitone. */
function majorCamelot(semitone: number): number {
  return (((semitone * 7) % 12) + 7) % 12 + 1;
}

/**
 * Convert a key tag to Camelot notation ("8A" = A minor, "8B" = C major).
 * Accepts "Am", "A minor", "A min", "C#m", "Dbmaj", "F# major", "8A", and
 * Open Key ("1m", "1d"). Returns null when the tag can't be read.
 */
export function toCamelot(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;

  const camelot = s.match(/^(1[0-2]|[1-9])\s?([AB])$/);
  if (camelot) return `${Number(camelot[1])}${camelot[2]}`;

  const openKey = s.match(/^(1[0-2]|[1-9])\s?([MD])$/);
  if (openKey) {
    const num = ((Number(openKey[1]) + 6) % 12) + 1;
    return `${num}${openKey[2] === "M" ? "A" : "B"}`;
  }

  const named = s.match(/^([A-G])\s?([#B♯♭])?\s?(MINOR|MIN|M|MAJOR|MAJ)?$/);
  if (!named) return null;
  const accidental = named[2] === "♯" ? "#" : named[2] === "♭" ? "B" : named[2] ?? "";
  const semitone = NOTE_TO_SEMITONE[`${named[1]}${accidental}`];
  if (semitone === undefined) return null;
  const quality = named[3] ?? "MAJOR";
  const isMinor = quality === "M" || quality === "MIN" || quality === "MINOR";
  if (isMinor) {
    // A minor shares a Camelot number with its relative major, C.
    return `${majorCamelot((semitone + 3) % 12)}A`;
  }
  return `${majorCamelot(semitone)}B`;
}

function parseCamelot(key: string): { num: number; letter: "A" | "B" } | null {
  const m = key.match(/^(1[0-2]|[1-9])([AB])$/);
  return m ? { num: Number(m[1]), letter: m[2] as "A" | "B" } : null;
}

/**
 * Harmonic compatibility 0..1 on the Camelot wheel.
 * Same key 1.0 · ±1 step 0.9 · relative major/minor 0.8 · ±2 steps 0.5 · other 0.1.
 * Unknown keys score a neutral 0.5 so untagged tracks are not excluded.
 */
export function keyCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5;
  const ka = parseCamelot(a);
  const kb = parseCamelot(b);
  if (!ka || !kb) return 0.5;
  const diff = Math.abs(ka.num - kb.num);
  const steps = Math.min(diff, 12 - diff);
  if (ka.letter === kb.letter) {
    if (steps === 0) return 1;
    if (steps === 1) return 0.9;
    if (steps === 2) return 0.5;
    return 0.1;
  }
  return steps === 0 ? 0.8 : 0.1;
}
