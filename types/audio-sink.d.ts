// Audio output selection (AudioContext.setSinkId, Chrome/Edge 110+). Not in
// TypeScript's DOM types yet; optional so code feature-detects it.
interface AudioContext {
  readonly sinkId?: string | { type: "none" };
  setSinkId?(sinkId: string | { type: "none" }): Promise<void>;
}
