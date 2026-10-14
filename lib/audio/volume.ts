// Master volume: the booth's volume control (0..1, saved in the settings) as a
// gain on the club speakers. PURE.

/** Gain for a volume setting: a squared taper, so the slider's middle sounds about half as loud (−12 dB). Never boosts. */
export function volumeGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  return v * v;
}
