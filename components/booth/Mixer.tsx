"use client";

import { useRef, type ReactNode } from "react";
import { EQ_KILL_DB } from "@/lib/audio/deck";
import { barAt, type CuePlan } from "@/lib/dj/cues";
import type { EntryChoice, Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";
import { formatTime, setText, useBoothFrame } from "./frame";
import { DisplayKnob, setKnob, VolumeKnob } from "./Knob";
import { DECK_LETTERS, LABEL, PANEL, SMALL_BUTTON } from "./theme";

/** What the mixer needs to know about one channel (deck). */
export interface Channel {
  deck: number;
  track: Track | null;
  /** LOAD: choose the song for this deck (before Play: load it; during the set: the cued song / the queue). */
  choose?: { label: string; open: () => void };
  /** 🎧 CUE: listen to the deck's song on the headphones, and whether the club would hear it. */
  cue?: { plan: CuePlan; blocked: boolean };
  /** Where the deck's song starts ("Set start here" while listening). */
  entry?: { set: (choice: EntryChoice) => void };
}

/** dB → knob position: 0 dB at the centre, a kill fully left, +6 dB fully right. */
const eqKnob = (db: number) => (db >= 0 ? db / 6 : db / -EQ_KILL_DB);
/** Peak level → meter height (−48 dB … 0 dB). */
const meter = (peak: number) => Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(1e-5, peak))) / 48));
const METER_STEPS = 12;

/**
 * The mixer between the two decks, laid out like a DDJ-FLX4's: MASTER and
 * PHONES levels either side of the set's Play / Stop, LOAD buttons, then per
 * channel TRIM, HI, MID, LOW and CFX, 🎧 CUE, the channel fader with its level
 * meter, and the crossfader. Staff turn only the two volumes: the EQ, filter,
 * faders and crossfader show what the auto-DJ is doing (owner decision 2 — the
 * auto-DJ mixes), moving by themselves like motorised controls. The centre holds
 * the auto-DJ's own controls: AI DJ, DROP and the beat FX.
 */
export function Mixer({
  channels,
  color,
  playing,
  playStop,
  aiDj,
  drop,
  fx,
  meterBar,
}: {
  /** Channel 1 (left) and 2 (right). */
  channels: [Channel, Channel];
  color: string;
  playing: boolean;
  playStop: ReactNode;
  aiDj: ReactNode;
  drop: ReactNode;
  fx: ReactNode;
  meterBar: ReactNode;
}) {
  const volume = useLibrary((s) => s.settings.volume);
  const previewVolume = useLibrary((s) => s.settings.previewVolume);
  const setVolume = useSession((s) => s.setVolume);
  const setPreviewVolume = useLibrary((s) => s.setPreviewVolume);
  return (
    <section aria-label="Mixer" className={`${PANEL} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <VolumeKnob label="Master" name="Club speakers volume" value={volume} onChange={setVolume} color={color} />
        {playStop}
        <VolumeKnob label="Phones" name="Headphones volume" value={previewVolume} onChange={setPreviewVolume} color={color} />
      </div>
      {/* Its space is kept, so nothing moves when it shows. */}
      <p className="min-h-[1.25rem] text-center text-xs text-warn" style={{ visibility: playing && volume === 0 ? "visible" : "hidden" }}>
        Volume is at 0 — the club hears nothing
      </p>
      {meterBar}
      <div className="grid grid-cols-2 gap-2">
        {channels.map((c) => (
          <LoadButton key={c.deck} channel={c} />
        ))}
      </div>
      <div className="grid grid-cols-[3.25rem_1fr_3.25rem] items-start gap-2">
        <ChannelKnobs deck={channels[0].deck} />
        <div className="flex min-w-0 flex-col items-center gap-3 pt-1">
          {aiDj}
          {drop}
          {fx}
        </div>
        <ChannelKnobs deck={channels[1].deck} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {channels.map((c) => (
          <ListenButtons key={c.deck} channel={c} />
        ))}
      </div>
      <Faders decks={[channels[0].deck, channels[1].deck]} color={color} />
    </section>
  );
}

/** LOAD: the picker for this deck. */
export function LoadButton({ channel }: { channel: Channel }) {
  const letter = DECK_LETTERS[channel.deck];
  return (
    <button
      type="button"
      className={`${SMALL_BUTTON} h-10 w-full`}
      disabled={!channel.choose}
      onClick={channel.choose?.open}
      aria-label={`${channel.choose?.label ?? (channel.track ? "Change track" : "Load track")}, Deck ${letter}`}
      title={channel.choose?.label ?? "Load a song into this deck"}
    >
      Load {letter}
      <span className="block truncate text-[9px] font-semibold normal-case tracking-normal text-[#9a9aa6]">{channel.choose?.label ?? "—"}</span>
    </button>
  );
}

/** TRIM, HI, MID, LOW and CFX of one channel, set by the auto-DJ (volume matching, transitions). */
function ChannelKnobs({ deck }: { deck: number }) {
  const trim = useRef<HTMLSpanElement>(null);
  const hi = useRef<HTMLSpanElement>(null);
  const mid = useRef<HTMLSpanElement>(null);
  const low = useRef<HTMLSpanElement>(null);
  const cfx = useRef<HTMLSpanElement>(null);
  useBoothFrame((snap) => {
    const v = snap?.decks[deck] ?? null;
    setKnob(trim.current, v ? v.trimDb / 12 : 0);
    setKnob(hi.current, v ? eqKnob(v.highDb) : 0);
    setKnob(mid.current, v ? eqKnob(v.midDb) : 0);
    setKnob(low.current, v ? eqKnob(v.bassDb) : 0);
    setKnob(cfx.current, v ? v.cfx : 0);
  });
  return (
    <div className="flex flex-col items-center gap-1.5" aria-hidden>
      <DisplayKnob label="Trim" indicator={trim} title="Trim — the auto-DJ matches each song's loudness" />
      <DisplayKnob label="Hi" indicator={hi} />
      <DisplayKnob label="Mid" indicator={mid} />
      <DisplayKnob label="Low" indicator={low} title="Low — the auto-DJ swaps the basslines in a mix" />
      <DisplayKnob label="CFX" indicator={cfx} title="Colour FX — the auto-DJ's filter sweeps (left low-pass, right high-pass)" />
    </div>
  );
}

/** 🎧 CUE: the deck's song on the headphones only; "Set start" turns the spot you hear into its start point. */
export function ListenButtons({ channel }: { channel: Channel }) {
  const { deck, track, cue, entry } = channel;
  const letter = DECK_LETTERS[deck];
  const cueTag = `cue:${deck}`;
  const cueing = usePreview((s) => s.playing === cueTag);
  const cueLoading = usePreview((s) => s.loading);
  const playPreview = usePreview((s) => s.play);
  const stopPreview = usePreview((s) => s.stop);
  const getFile = useLibrary((s) => s.getFile);
  const head = useRef<HTMLSpanElement>(null);
  useBoothFrame(() => {
    const preview = usePreview.getState();
    const pos = preview.playing === cueTag ? (preview.position() ?? 0) : null;
    setText(head.current, pos === null ? "" : `cue ${formatTime(pos)}.${Math.floor((pos % 1) * 10)}`);
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        className={`${SMALL_BUTTON} h-9 w-full`}
        disabled={!cue || !track || cue.blocked || (cueLoading && !cueing)}
        aria-label={cueing ? `Stop listening, Deck ${letter}` : `Listen, Deck ${letter}`}
        aria-pressed={cueing}
        title={cue?.blocked ? "Choose a separate preview output (Library → Audio outputs) to listen during a set" : "Listen on the headphones (the preview output); the club hears nothing"}
        style={cueing ? { borderColor: "#f59e0b", background: "#f59e0b", color: "#07070b" } : undefined}
        onClick={() =>
          cueing
            ? stopPreview()
            : cue &&
              track &&
              playPreview(cueTag, async (p) => p.playFrom(await getFile(track), cue.plan.from, cue.plan.jump ? { jump: { ...cue.plan.jump, after: 30 } } : { length: 60 }))
        }
      >
        🎧 Cue
      </button>
      <button
        type="button"
        className={`${SMALL_BUTTON} w-full px-1 normal-case tracking-normal`}
        disabled={!cueing || !entry}
        aria-label={`Set start here, Deck ${letter}`}
        title="Start the song where you're listening"
        onClick={() => {
          const pos = usePreview.getState().position();
          if (pos !== null && track?.analysis) entry?.set({ kind: "bar", bar: barAt(track.analysis, pos) });
        }}
      >
        Set start here
      </button>
      <span ref={head} data-testid={`cue-head-${letter}`} className="h-3 font-mono text-[10px] leading-3 text-[#9a9aa6]" />
    </div>
  );
}

/** Channel faders with their level meters, and the crossfader: where the auto-DJ has the mix. */
function Faders({ decks, color }: { decks: [number, number]; color: string }) {
  const caps = useRef<(HTMLSpanElement | null)[]>([]);
  const meters = useRef<(HTMLSpanElement | null)[][]>([[], []]);
  const xfader = useRef<HTMLSpanElement>(null);
  useBoothFrame((snap) => {
    const views = decks.map((d) => snap?.decks[d] ?? null);
    views.forEach((v, i) => {
      const cap = caps.current[i];
      if (cap) cap.style.bottom = `calc(${(v?.fader ?? 0) * 100}% * 0.82)`;
      const lit = Math.round(meter(v?.level ?? 0) * METER_STEPS);
      meters.current[i].forEach((seg, k) => {
        if (seg) seg.style.opacity = k < lit ? "1" : "0.12";
      });
    });
    // Crossfader: left with only channel 1 up, right with only channel 2, centre with both.
    const [a, b] = views.map((v) => v?.fader ?? 0);
    const x = a + b > 0.001 ? 0.5 + (b - a) / 2 : 0.5;
    if (xfader.current) xfader.current.style.left = `calc(${x * 100}% * 0.84)`;
  });
  const segColor = (k: number) => (k >= METER_STEPS - 2 ? "#ef4444" : k >= METER_STEPS - 4 ? "#f59e0b" : color);
  return (
    <div className="flex flex-col gap-3" aria-hidden title="Channel faders and crossfader — moved by the auto-DJ">
      <div className="flex items-stretch justify-center gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-stretch gap-2">
            {i === 1 && <Meter steps={METER_STEPS} onRef={(k, el) => (meters.current[1][k] = el)} segColor={segColor} />}
            <div className="flex flex-col items-center gap-1">
              <div className="relative h-24 w-8">
                <span className="absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-[#050506] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]" />
                <span
                  ref={(el) => {
                    caps.current[i] = el;
                  }}
                  data-testid={`fader-${i + 1}`}
                  className="absolute left-0 h-[18%] w-8 rounded-sm border border-[#4a4a54] bg-[linear-gradient(180deg,#3a3a42,#1c1c22)] shadow-[0_3px_5px_rgba(0,0,0,0.6)]"
                  style={{ bottom: 0 }}
                >
                  <span className="absolute inset-x-1 top-1/2 h-px bg-white/70" />
                </span>
              </div>
              <span className={LABEL}>Ch {i + 1}</span>
            </div>
            {i === 0 && <Meter steps={METER_STEPS} onRef={(k, el) => (meters.current[0][k] = el)} segColor={segColor} />}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="relative h-8 w-full max-w-[12rem]">
          <span className="absolute inset-x-1 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#050506] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]" />
          <span
            ref={xfader}
            data-testid="crossfader"
            className="absolute top-0 h-8 w-[16%] rounded-sm border border-[#4a4a54] bg-[linear-gradient(180deg,#3a3a42,#1c1c22)] shadow-[0_3px_5px_rgba(0,0,0,0.6)]"
            style={{ left: "42%" }}
          >
            <span className="absolute inset-y-1 left-1/2 w-px bg-white/70" />
          </span>
        </div>
        <span className={LABEL}>Crossfader</span>
      </div>
    </div>
  );
}

function Meter({ steps, onRef, segColor }: { steps: number; onRef: (k: number, el: HTMLSpanElement | null) => void; segColor: (k: number) => string }) {
  return (
    <div className="flex h-24 flex-col-reverse justify-between py-1">
      {Array.from({ length: steps }, (_, k) => (
        <span
          key={k}
          ref={(el) => {
            onRef(k, el);
          }}
          className="h-[5px] w-2 rounded-[1px]"
          style={{ background: segColor(k), opacity: 0.12 }}
        />
      ))}
    </div>
  );
}
