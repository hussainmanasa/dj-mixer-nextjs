"use client";

import { useRef, type ReactNode } from "react";
import { channelGainOf, eqKnobOf, eqDbOf, trimDbOf, TRIM_DB, type MixerChannel } from "@/lib/audio/mixer";
import { barAt, type CuePlan } from "@/lib/dj/cues";
import type { EntryChoice, Track } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { usePreview } from "@/store/preview";
import { useSession } from "@/store/session";
import { formatTime, setText, useBoothFrame } from "./frame";
import { Fader } from "./Fader";
import { Knob, setKnob, VolumeKnob } from "./Knob";
import { DECK_LETTERS, PANEL, SMALL_BUTTON } from "./theme";

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

/** Peak level → meter height (−48 dB … 0 dB). */
const meter = (peak: number) => Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(1e-5, peak))) / 48));
const METER_STEPS = 12;

/**
 * The mixer between the two decks, laid out like a DDJ-FLX4's: MASTER and
 * PHONES levels either side of the set's Play / Stop, LOAD buttons, then per
 * channel TRIM, HI, MID, LOW and CFX, 🎧 CUE, the channel fader with its level
 * meter, and the crossfader. Every knob and fader works (owner decision): they
 * set the channel's own stage, after the auto-DJ's automation, so the auto-DJ
 * still beat-matches and mixes underneath — a dot on each knob and a tick by
 * each fader show what it is doing. The centre holds AI DJ, DROP and Beat FX.
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
  // A playing deck staff turned all the way down (channel fader or crossfader): say so, the club can't hear it.
  const muted = useSession((s) => {
    const st = s.status;
    if (!st.playing || st.silent) return null;
    const sounding = [st.now?.deck, st.next && st.next.together ? st.next.deck : undefined].filter((d): d is number => d !== undefined);
    const down = sounding.filter((d) => d < 2 && channelGainOf(s.mixer[d], s.crossfader, d as 0 | 1) < 0.03);
    return down.length ? down.map((d) => DECK_LETTERS[d]).join(" and ") : null;
  });
  return (
    <section aria-label="Mixer" className={`${PANEL} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <VolumeKnob label="Master" name="Club speakers volume" value={volume} onChange={setVolume} color={color} />
        {playStop}
        <VolumeKnob label="Phones" name="Headphones volume" value={previewVolume} onChange={setPreviewVolume} color={color} />
      </div>
      {/* Its space is kept, so nothing moves when it shows. */}
      <p className="min-h-[1.25rem] text-center text-xs text-warn" style={{ visibility: (playing && volume === 0) || muted ? "visible" : "hidden" }}>
        {playing && volume === 0 ? "Volume is at 0 — the club hears nothing" : muted ? `Deck ${muted} turned down — the club doesn't hear it` : " "}
      </p>
      {meterBar}
      <div className="grid grid-cols-2 gap-2">
        {channels.map((c) => (
          <LoadButton key={c.deck} channel={c} />
        ))}
      </div>
      <div className="grid grid-cols-[3.25rem_1fr_3.25rem] items-start gap-2">
        <ChannelKnobs deck={channels[0].deck} color={color} />
        <div className="flex min-w-0 flex-col items-center gap-3 pt-1">
          {aiDj}
          {drop}
          {fx}
        </div>
        <ChannelKnobs deck={channels[1].deck} color={color} />
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

const dB = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

/**
 * TRIM, HI, MID, LOW and CFX of one channel. Staff turn them (on top of the auto-DJ's volume matching and EQ moves,
 * which the dot on each ring shows); double-click centres one.
 */
function ChannelKnobs({ deck, color }: { deck: number; color: string }) {
  const channel = useSession((s) => s.mixer[deck]);
  const setMixer = useSession((s) => s.setMixer);
  const letter = DECK_LETTERS[deck];
  const trim = useRef<HTMLSpanElement>(null);
  const hi = useRef<HTMLSpanElement>(null);
  const mid = useRef<HTMLSpanElement>(null);
  const low = useRef<HTMLSpanElement>(null);
  const cfx = useRef<HTMLSpanElement>(null);
  useBoothFrame((snap) => {
    const v = snap?.decks[deck] ?? null;
    setKnob(trim.current, v ? v.trimDb / TRIM_DB : 0);
    setKnob(hi.current, v ? eqKnobOf(v.highDb) : 0);
    setKnob(mid.current, v ? eqKnobOf(v.midDb) : 0);
    setKnob(low.current, v ? eqKnobOf(v.bassDb) : 0);
    setKnob(cfx.current, v ? v.cfx : 0);
  });
  const knob = (key: keyof MixerChannel, label: string, auto: React.Ref<HTMLSpanElement>, text: (v: number) => string, title: string) => (
    <Knob
      label={label}
      name={`${label}, Deck ${letter}`}
      value={channel[key]}
      onChange={(v) => setMixer(deck, { [key]: v })}
      color={color}
      auto={auto}
      valueText={text}
      title={title}
    />
  );
  return (
    <div className="flex flex-col items-center gap-1.5">
      {knob("trim", "Trim", trim, (v) => dB(trimDbOf(v)), "Trim ±12 dB (the dot: the auto-DJ's loudness matching)")}
      {knob("hi", "Hi", hi, (v) => dB(eqDbOf(v)), "High EQ: kill … +6 dB (the dot: the auto-DJ's)")}
      {knob("mid", "Mid", mid, (v) => dB(eqDbOf(v)), "Mid EQ: kill … +6 dB (the dot: the auto-DJ's)")}
      {knob("low", "Low", low, (v) => dB(eqDbOf(v)), "Low EQ: kill … +6 dB (the dot: the auto-DJ's bass swaps)")}
      {knob(
        "cfx",
        "CFX",
        cfx,
        (v) => (Math.abs(v) < 0.02 ? "off" : v < 0 ? `low-pass ${Math.round(-v * 100)}%` : `high-pass ${Math.round(v * 100)}%`),
        "Colour FX: left low-pass, right high-pass, off in the centre (the dot: the auto-DJ's filter sweeps)",
      )}
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

/**
 * Channel faders with their level meters, and the crossfader. Staff move them; the tick beside each fader is the
 * auto-DJ's own fade on that channel. The crossfader's centre leaves both channels full; each end cuts the other.
 */
function Faders({ decks, color }: { decks: [number, number]; color: string }) {
  const mixer = useSession((s) => s.mixer);
  const crossfader = useSession((s) => s.crossfader);
  const setMixer = useSession((s) => s.setMixer);
  const setCrossfader = useSession((s) => s.setCrossfader);
  const ticks = useRef<(HTMLSpanElement | null)[]>([]);
  const meters = useRef<(HTMLSpanElement | null)[][]>([[], []]);
  useBoothFrame((snap) => {
    decks.forEach((d, i) => {
      const v = snap?.decks[d] ?? null;
      const tick = ticks.current[i];
      if (tick) tick.style.bottom = `calc(${(v?.fader ?? 0) * 100}% * 0.82 + 9%)`;
      const lit = Math.round(meter(v?.level ?? 0) * METER_STEPS);
      meters.current[i].forEach((seg, k) => {
        if (seg) seg.style.opacity = k < lit ? "1" : "0.12";
      });
    });
  });
  const segColor = (k: number) => (k >= METER_STEPS - 2 ? "#ef4444" : k >= METER_STEPS - 4 ? "#f59e0b" : color);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-center gap-4">
        {decks.map((d, i) => (
          <div key={d} className="flex items-start gap-2">
            {i === 1 && <Meter steps={METER_STEPS} onRef={(k, el) => (meters.current[1][k] = el)} segColor={segColor} />}
            <Fader
              name={`Channel fader, Deck ${DECK_LETTERS[d]}`}
              label={`Ch ${i + 1}`}
              orientation="vertical"
              value={mixer[d].fader}
              reset={1}
              onChange={(v) => setMixer(d, { fader: v })}
              testId={`fader-${i + 1}`}
              auto={(el) => {
                ticks.current[i] = el;
              }}
            />
            {i === 0 && <Meter steps={METER_STEPS} onRef={(k, el) => (meters.current[0][k] = el)} segColor={segColor} />}
          </div>
        ))}
      </div>
      <Fader
        name="Crossfader"
        label="Crossfader"
        orientation="horizontal"
        value={crossfader}
        reset={0.5}
        onChange={setCrossfader}
        testId="crossfader"
        className="mx-auto w-full max-w-[12rem]"
      />
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
