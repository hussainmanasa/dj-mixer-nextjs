// Song markers (dialogue, hook, default start) and where a song comes in. PURE.

import type { EntryChoice, Track, TrackAnalysis, TrackCues } from "@/lib/types";
import { barSeconds, cueIn, dropCue } from "./mixpoints";

/** An opener with no hook marker plays this many bars from its start before the auto-drop. */
export const OPENER_BARS = 32;

/** How a song comes in on a drop-style transition. Positions are track seconds. */
export interface Entry {
  /** The position that lands on the transition's landing point (its drop, hook or a chosen bar). */
  land: number;
  /** Play this dialogue first; when it ends the deck jumps to `land`. */
  dialogue?: { start: number; end: number };
}

/** The dialogue marker, if it is complete and sensible. */
export function dialogueOf(cues: TrackCues | undefined): { start: number; end: number } | undefined {
  if (cues?.dialogueStart === undefined || cues.dialogueEnd === undefined) return undefined;
  return cues.dialogueEnd > cues.dialogueStart ? { start: cues.dialogueStart, end: cues.dialogueEnd } : undefined;
}

/** The hook marker, if complete. */
export function hookOf(cues: TrackCues | undefined): { start: number; end: number } | undefined {
  if (cues?.hookStart === undefined || cues.hookEnd === undefined) return undefined;
  return cues.hookEnd > cues.hookStart ? { start: cues.hookStart, end: cues.hookEnd } : undefined;
}

/** Where a song starts by default: its start marker, else its first downbeat. */
export function defaultStart(track: Track): number {
  return track.cues?.start ?? cueIn(track.analysis!);
}

/** Nearest downbeat to a track position (markers that must sit on the grid). */
export function snapToBar(a: TrackAnalysis, position: number): number {
  const bar = barSeconds(a);
  return Math.max(0, a.firstBeat + Math.round((position - a.firstBeat) / bar) * bar);
}

/**
 * How a song comes in, from staff's "Start from" choice. `auto` plays its
 * dialogue (if marked) and then drops; otherwise it lands on its drop.
 */
export function resolveEntry(track: Track, choice: EntryChoice = { kind: "auto" }): Entry {
  const a = track.analysis!;
  const dialogue = dialogueOf(track.cues);
  switch (choice.kind) {
    case "beginning":
      return { land: cueIn(a) };
    case "hook":
      return { land: hookOf(track.cues)?.start ?? dropCue(a) };
    case "drop":
      return { land: dropCue(a) };
    case "bar":
      return { land: Math.min(a.duration - barSeconds(a), Math.max(0, a.firstBeat + choice.bar * barSeconds(a))) };
    default:
      return dialogue ? { land: dropCue(a), dialogue } : { land: dropCue(a) };
  }
}

/** Which "Start from" choices make sense for a song (dialogue / hook only when marked). */
export function entryOptions(track: Track): EntryChoice["kind"][] {
  const options: EntryChoice["kind"][] = ["auto", "beginning"];
  if (dialogueOf(track.cues)) options.push("dialogue");
  if (hookOf(track.cues)) options.push("hook");
  options.push("drop");
  return options;
}

/** The part of an opener that plays before the auto-drop: its hook, else OPENER_BARS from its start. */
export function openerWindow(track: Track): { start: number; end: number } {
  const a = track.analysis!;
  const hook = hookOf(track.cues);
  if (hook) return hook;
  const start = defaultStart(track);
  return { start, end: Math.min(a.duration - 2 * barSeconds(a), start + OPENER_BARS * barSeconds(a)) };
}

/** Problems with a set of markers, as messages for the editor (empty = fine). */
export function validateCues(c: TrackCues, duration: number): string[] {
  const errors: string[] = [];
  const inside = (v: number | undefined) => v === undefined || (v >= 0 && v <= duration);
  if (![c.start, c.hookStart, c.hookEnd, c.dialogueStart, c.dialogueEnd].every(inside)) errors.push("Markers must be inside the song.");
  if (c.hookStart !== undefined && c.hookEnd !== undefined && c.hookEnd <= c.hookStart) errors.push("The hook must end after it starts.");
  if (c.dialogueStart !== undefined && c.dialogueEnd !== undefined && c.dialogueEnd <= c.dialogueStart)
    errors.push("The dialogue must end after it starts.");
  if ((c.hookStart === undefined) !== (c.hookEnd === undefined)) errors.push("Mark both the start and the end of the hook.");
  if ((c.dialogueStart === undefined) !== (c.dialogueEnd === undefined)) errors.push("Mark both the start and the end of the dialogue.");
  return errors;
}

/** How the first song of a set starts (a deck loaded before Play). Track seconds. */
export interface FirstStart {
  /** Where it starts playing. */
  start: number;
  /** A dialogue start: after `after` seconds it jumps to `to` (its drop). */
  jump?: { after: number; to: number };
  /** It opens a mood with an opener: it auto-drops into the party at this position (its hook's end). */
  openerEnd?: number;
}

/**
 * Where the set's first song starts, from staff's "Start from" choice.
 * `opener`: the mood opens with a hook (Desi Night) — then Auto (or Hook)
 * plays the hook and auto-drops when it ends.
 */
export function firstStart(track: Track, choice: EntryChoice = { kind: "auto" }, opener = false): FirstStart {
  const a = track.analysis!;
  switch (choice.kind) {
    case "beginning":
      return { start: 0 };
    case "drop":
      return { start: dropCue(a) };
    case "bar":
      return { start: resolveEntry(track, choice).land };
    case "dialogue": {
      const d = dialogueOf(track.cues);
      if (d) return { start: d.start, jump: { after: d.end - d.start, to: dropCue(a) } };
      return { start: defaultStart(track) };
    }
    case "hook":
    case "auto": {
      if (opener) {
        const w = openerWindow(track);
        return { start: w.start, openerEnd: w.end };
      }
      if (choice.kind === "hook") return { start: hookOf(track.cues)?.start ?? defaultStart(track) };
      return { start: defaultStart(track) };
    }
  }
}

/**
 * Where a layered song comes in (Layer): its hook — the part worth hearing
 * over another song — else its drop. A Start from of beginning, drop or a bar
 * is honoured; a dialogue isn't played under another song.
 */
export function layerEntry(track: Track, choice: EntryChoice = { kind: "auto" }): number {
  if (choice.kind === "beginning" || choice.kind === "drop" || choice.kind === "bar") return resolveEntry(track, choice).land;
  return hookOf(track.cues)?.start ?? dropCue(track.analysis!);
}

/** What Cue plays for a deck: from where it will start, through its dialogue's jump to the drop if any. */
export interface CuePlan {
  from: number;
  jump?: { at: number; to: number };
}

/**
 * Cue for a loaded or cued deck: from its start point — Deck A's first start
 * (`first`, with `opener` for opener moods) or how a later deck comes in.
 */
export function cuePlan(track: Track, choice: EntryChoice, first: boolean, opener = false): CuePlan {
  if (first) {
    const fs = firstStart(track, choice, opener);
    return fs.jump ? { from: fs.start, jump: { at: fs.start + fs.jump.after, to: fs.jump.to } } : { from: fs.start };
  }
  const e = resolveEntry(track, choice);
  return e.dialogue ? { from: e.dialogue.start, jump: { at: e.dialogue.end, to: e.land } } : { from: e.land };
}

/** The bar (from the first downbeat) nearest a track position — for "Set start here". */
export function barAt(a: TrackAnalysis, position: number): number {
  return Math.max(0, Math.round((position - a.firstBeat) / barSeconds(a)));
}

/** A track position snapped to the nearest beat, as a (fractional) bar from the first downbeat: 10.25 = bar 11, beat 2. */
export function beatBar(a: TrackAnalysis, position: number): number {
  const beat = barSeconds(a) / 4;
  return Math.max(0, Math.round((position - a.firstBeat) / beat)) / 4;
}

/** "Bar 11.2" for a fractional bar (bar 11, beat 2), counting from 1. */
export function barLabel(bar: number): string {
  const whole = Math.floor(bar + 1e-9);
  return `Bar ${whole + 1}.${Math.round((bar - whole) * 4) + 1}`;
}

