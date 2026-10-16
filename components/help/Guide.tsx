import Link from "next/link";
import type { ReactNode } from "react";
import { ContentsNav } from "./ContentsNav";

// The in-app user guide (/help): everything staff and the venue admin need,
// in plain words. A server component — static text, no audio. Keep it in step
// with the app: when a control changes, change its section here too.

const SECTIONS = [
  { id: "quick-start", title: "Quick start" },
  { id: "before", title: "Before the night" },
  { id: "booth", title: "The booth at a glance" },
  { id: "track-view", title: "Track view" },
  { id: "moods", title: "Moods" },
  { id: "play", title: "Play, Stop and the auto-DJ" },
  { id: "ai-dj", title: "AI DJ on / off" },
  { id: "load", title: "Loading decks before Play" },
  { id: "during", title: "During the set" },
  { id: "decks", title: "Deck controls" },
  { id: "jog", title: "The jog wheel" },
  { id: "tempo", title: "Tempo sliders and Sync" },
  { id: "pads", title: "Cue pads" },
  { id: "loops", title: "Loops" },
  { id: "headphones", title: "Headphones: Cue and previews" },
  { id: "volume", title: "Volume" },
  { id: "desi", title: "Desi Night" },
  { id: "library", title: "Library (admin)" },
  { id: "editor", title: "Fixing a track" },
  { id: "moods-page", title: "Moods page (admin)" },
  { id: "history", title: "History" },
  { id: "venue", title: "Running it at the venue" },
  { id: "music", title: "Where the music comes from" },
  { id: "keys", title: "Keyboard and mouse" },
  { id: "trouble", title: "Troubleshooting" },
] as const;

export function Guide() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-6 py-8 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="Contents" className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-auto">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">Contents</h2>
        <ContentsNav sections={SECTIONS} />
      </nav>

      <article className="min-w-0 max-w-3xl space-y-12 leading-relaxed">
        <header>
          <h1 className="text-3xl font-bold">How to use AI DJ Mixer</h1>
          <p className="mt-3 text-lg text-muted">
            Pick a mood and press <strong className="text-foreground">Play</strong>: the auto-DJ chooses every song from the
            club&apos;s own music, beat-matches it and mixes it in. Everything else on this page is optional — ways to steer it.
          </p>
        </header>

        <Section id="quick-start" title="Quick start">
          <Steps>
            <li>
              Open <Link href="/library" className="text-accent underline underline-offset-2">Library</Link> → <B>Choose music folder</B> and pick the folder with the club&apos;s songs.
              Wait until the songs show <B>Ready</B> (each one is analysed once).
            </li>
            <li>
              Still on Library, under <B>Audio outputs</B>, choose the <B>Club speakers</B> and (optional) a separate <B>Preview &amp; Cue</B>{" "}
              output for headphones.
            </li>
            <li>
              Open <Link href="/booth" className="text-accent underline underline-offset-2">Booth</Link>, tap a <B>mood</B>, press the big green <B>Play</B>.
            </li>
            <li>Change the mood whenever the room changes. The music never stops.</li>
            <li>
              To end the night press <B>Stop</B> — the music fades out over 2 seconds.
            </li>
          </Steps>
          <Tip>
            The booth needs <B>Chrome or Edge on a computer</B> (it reads the music folder directly). Nothing is uploaded: the songs stay on
            that computer.
          </Tip>
        </Section>

        <Section id="before" title="Before the night">
          <Dl
            items={[
              ["Music folder", "Library → Choose music folder. Subfolders are fine. Formats: MP3, M4A/AAC, WAV, FLAC, Ogg, Opus (not AIFF). New songs are picked up with Rescan."],
              [
                "Analysis",
                "Each song is analysed once in the background: tempo, beat grid, drops, loudness and key (a key in the file's tags wins). Songs can play while others are still analysing.",
              ],
              ["Decks", "2 decks by default; 3 or 4 keep a spare song ready so a problem is fixed instantly. Changes apply straight away, even mid-set."],
              [
                "Key lock (beta)",
                "Keeps songs in their own key while the auto-DJ changes their tempo. Switches straight away, even mid-set (you may hear a very short smear). Listen on the venue system before a busy night.",
              ],
              [
                "Audio outputs",
                "Club speakers get the mix (Bluetooth speaker, 3.5 mm jack…). Preview & Cue gets everything you listen to in headphones (USB-C or HDMI audio…). Test sound checks each one. They must be two different devices to preview during a set.",
              ],
            ]}
          />
          <Tip>Every setting applies the moment you change it — no refresh, no Stop — and also reaches the booth if Library is open in another tab.</Tip>
        </Section>

        <Section id="booth" title="The booth at a glance">
          <p>
            The booth is laid out like a <B>Pioneer DDJ-FLX4</B> controller, with the software&apos;s screen above it.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Screen</B> (top): the <B>Mood</B> buttons, the <B>Track view</B> (each deck&apos;s bar, phrase and countdowns; the cued
              deck&apos;s row also says how its song comes in, e.g. &quot;Filter sweep&quot; or &quot;After this song&quot;) and a line for
              notes from the auto-DJ.
            </li>
            <li>
              <B>Decks</B> left (A) and right (B), each like the controller&apos;s: the <B>loop section</B> (IN, OUT, 4 BEAT / EXIT, ½, 2×) and{" "}
              <B>BEAT SYNC</B> along the top; a small display with the song, key, BPM, time, its overview (green blocks = full sections, gaps
              = breakdowns, ⚑ = where it will start), Start from and ⏏ eject; the <B>jog wheel</B> with the <B>tempo slider</B> on its right;
              and at the bottom the round <B>CUE</B> and <B>▶ Play / ⏸ Pause</B> buttons beside the <B>pad modes</B> (HOT CUE, BEAT LOOP,
              SAVED) and 8 pads. The badge says what the deck is doing: <B>On air</B>, <B>Cued</B> (comes in next), <B>Mixing in / out</B>,{" "}
              <B>Playing along</B>, <B>Paused</B>, <B>Standby</B> (spare song), <B>Loaded</B> (before Play) or <B>Empty</B>.
            </li>
            <li>
              <B>Mixer</B> in the middle: <B>MASTER</B> (club speakers) and <B>PHONES</B> (headphones) volume knobs either side of the set&apos;s{" "}
              <B>Play / Stop</B>, the master level, a <B>LOAD</B> button per deck, then per channel <B>TRIM, HI, MID, LOW</B> and{" "}
              <B>CFX</B>, <B>🎧 CUE</B> and <B>Set start here</B>, the channel faders with their level meters, and the crossfader. Down the
              middle: the <B>AI DJ</B> switch, <B>Drop</B> and <B>Beat FX</B>.
            </li>
            <li>
              <B>Every knob and fader works.</B> TRIM (±12 dB), HI / MID / LOW (full left kills that band, full right +6 dB), CFX (left: a
              low-pass filter, right: a high-pass, off in the centre), the channel faders and the crossfader (centre: both decks full; each
              end cuts the other deck). Drag a knob up or down (or scroll, or click it and use the arrow keys); drag or click a fader;
              double-click either to put it back. They work on top of the auto-DJ, which still beat-matches and mixes underneath: the small
              dot on each knob&apos;s ring and the tick beside each fader show what the auto-DJ itself is doing. Turn a playing deck all the
              way down and the mixer says so (&quot;Deck A turned down&quot;) — the auto-DJ treats that silence as yours, not as a fault.
            </li>
            <li>With 3 or 4 decks, decks C and D sit below with their own LOAD and 🎧 CUE.</li>
            <li>The background pulses with the beat in the mood&apos;s colour.</li>
          </ul>
        </Section>

        <Section id="track-view" title="Track view">
          <p>
            Above the decks, the songs on the decks are shown one below another (the loaded ones before Play; the song on air and the cued
            one during the set). Each row has:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Details:</B> deck, what it&apos;s doing, title, artist, key, BPM and tempo change, time played and left.
            </li>
            <li>
              <B>The waveform</B> scrolling past the white centre line: the bass (kicks, basslines) in the mood colour, the rest in white;
              drops are shaded. Thin lines are beats, brighter numbered lines are bars, and a coloured line starts each 8-bar phrase. Cue pads
              show as lettered flags, <B>MIX</B> marks where the song on air will mix out and <B>IN</B> where the cued song starts — the cued
              song scrolls in from the right before it plays.
            </li>
            <li>
              <B>Beats:</B> four dots for the beat in the bar, the bar and beat (&quot;Bar 17.3&quot;), the phrase (&quot;Phrase 3 · 5/8&quot;),
              and what&apos;s next: the mix countdown, when the cued song comes in, and the next drop.
            </li>
          </ul>
          <p>
            Both rows use the same time scale, so during a mix you can watch the two songs&apos; beats land on the same lines. <B>+</B>{" "}
            zooms in and <B>−</B> out; the number between them is the zoom level, 1× to 8× (1× shows 32 seconds across, 8× shows 4 —
            hover it to see). A song&apos;s detailed waveform is prepared the first time it is on a deck (until then you see
            one block per bar) and kept for next time.
          </p>
        </Section>

        <Section id="moods" title="Moods">
          <Table
            head={["Mood", "Tempo", "Feel"]}
            rows={[
              ["Chill", "96–115 BPM", "Laid-back, low energy, slower tempos"],
              ["Warm-up", "112–122 BPM", "Early night, building slowly"],
              ["Groove", "118–126 BPM", "Steady, danceable, mid energy"],
              ["Peak Hour", "124–132 BPM", "Full floor, highest energy; swaps straight onto the next song's drop"],
              ["Afterhours", "120–130 BPM", "Late night, hypnotic and deep"],
              ["Desi Night", "90–135 BPM", "Bollywood & Punjabi: a slow opener's hook, then drop after drop (see Desi Night)"],
            ]}
          />
          <p>
            The mood only changes when you pick a new one. The auto-DJ eases into a close mood over the next 1–3 songs; a big tempo jump
            gets an echo-out instead. A mix that has already started always finishes first.
          </p>
        </Section>

        <Section id="play" title="Play, Stop and the auto-DJ">
          <p>
            After Play the auto-DJ does everything: it picks songs that fit the mood (and each other&apos;s key), matches their tempo, chooses
            the transition (long beat-matched blend, filter sweep, echo-out or cut) and times it on the beat — usually leaving a song as it
            breaks down after a drop, like a club DJ, rather than at its very end.
          </p>
          <p>
            <B>The music never stops by itself.</B> If a song fails to load, ends early or the sound goes silent, the auto-DJ starts another
            within a few seconds. After a power cut or reload it resumes the set on its own (in kiosk mode). The only silence is the one you
            choose with ⏸.
          </p>
          <p>
            <B>Stop</B> fades the whole set out over 2 seconds; the button is locked while it fades, so a double press can&apos;t restart it.
          </p>
        </Section>

        <Section id="ai-dj" title="AI DJ on / off">
          <p>
            The <B>AI DJ</B> switch under Play / Stop (during a set) decides who mixes. <B>On</B> (normal): the auto-DJ mixes songs in by
            itself — but only songs you leave alone. Once you play, pause or cue a song yourself (▶, ⏸, CUE, or a hand on its wheel), it
            never mixes that song in or out: it plays to its end and the next song starts then. <B>Off</B>: no automatic mixing at all —
            each song plays to its very end, and the cued song (still the best fit, which you can change) starts the moment it ends, with
            no blend and nothing overlapping. The cued deck&apos;s row in the track view says <B>After this song</B>. You can still mix by hand with <B>Drop</B> or <B>▶</B>.
            It stays off until you switch it on again.
          </p>
        </Section>

        <Section id="load" title="Loading decks before Play">
          <p>
            Before pressing Play you can choose the first songs yourself: <B>LOAD</B> for a deck (in the mixer), pick a song. Deck A plays first, then
            B, C, D in order; after them the auto-DJ carries on. Or press <B>▶ Play</B> on a loaded deck: the set starts with that
            deck&apos;s song, on that deck. <B>Change</B> or <B>Eject</B> to undo.
          </p>
          <p>
            <B>Start from</B> chooses where a song comes in: <B>Auto</B> (the auto-DJ decides), <B>Beginning</B>, <B>Dialogue</B> or{" "}
            <B>Hook</B> (when the song has those markers), <B>Drop</B>, or tap a bar in the overview / turn the jog wheel to set an exact point
            (e.g. &quot;Bar 11.2&quot; = bar 11, beat 2).
          </p>
        </Section>

        <Section id="during" title="During the set">
          <Dl
            items={[
              [
                "Drop",
                "Brings the next song in on its drop, on the next 4-bar phrase (about 6–13 s), with a build-up and a riser. With both decks playing (▶ on the cued deck), Drop swaps them on the next phrase — also when one of them is paused. Greyed out while a mix is already running, and when nothing is playing.",
              ],
              [
                "Beat FX (mixer)",
                "Echo, Filter, Reverb and Riser on the whole mix, starting on the next beat (the riser on the next bar). In Groove, Peak Hour and Desi Night the auto-DJ also adds effects itself as songs change — the pad lights up, marked “auto”.",
              ],
              [
                "LOAD (mixer)",
                "For the cued deck (it says Change track): choose the song that comes in next. The picker lists the best fits for the mood first (▶ previews a song on the headphones; “tempo jump” means it will echo out rather than blend).",
              ],
              ["The cued deck's row", "In the track view: the next song, how it will come in (e.g. Beat-matched blend, Drop, After this song, After the loop) and the countdown to it."],
            ]}
          />
          <Tip>Every request still goes through the auto-DJ: it beat-matches it, picks the transition and steers back to the mood afterwards.</Tip>
        </Section>

        <Section id="decks" title="Deck controls">
          <p>
            Every deck is a plain player: <B>CUE</B>, <B>▶ Play / ⏸ Pause</B>, loops, cue pads, tempo, Sync and the jog wheel work on any
            deck that has a song, at any time — AI DJ on or off, and also while the auto-DJ is in the middle of a mix (it then lets go,
            and the two songs play on side by side).
          </p>
          <Dl
            items={[
              [
                "▶ Play / ⏸ Pause",
                "One button. ⏸ stops the deck where it is; nothing else changes. With nothing else playing the club hears nothing until you press ▶ — for an announcement, a speech or the cake — and a yellow Paused banner shows. ▶ plays it from where it stands: with the other deck playing, in time with it (on its next beat) when their tempos allow, else straight away.",
              ],
              [
                "▶ on the cued deck",
                "Plays the cued song at once, at full level, so both decks play together — beat-matched on the song on air's next beat when their tempos allow, else right away at its own tempo. Nothing mixes or swaps by itself: both play until you press Drop (which mixes them) or a song reaches its end. If the song on air is paused, the cued song plays on its own.",
              ],
              [
                "CUE",
                "Works like a CDJ's. While the deck plays: back to the cue point, stopped there. Stopped somewhere else (paused, or moved with the wheel or a cue pad): that spot becomes the cue point. Stopped at the cue point: it plays from there while you hold CUE and goes back when you let go — press ▶ while holding and it keeps playing. A song's cue point starts where it began playing; on the cued deck it is the start point, so holding CUE plays the cued song from there on the speakers.",
              ],
              [
                "🎧 CUE (mixer)",
                "Plays the cued (or loaded) song on the headphones only — the club hears nothing. Set start here makes the spot you're hearing the start point. Needs a separate preview output during a set (Library → Audio outputs).",
              ],
              [
                "⏏ Eject",
                "Takes the song off a deck that isn't playing — before Play, the cued deck, or a deck you paused beside the song on air. The deck stays empty until you LOAD a song; if nobody does, the auto-DJ picks one about 30 seconds before the song on air ends, so the music never stops. Like a CDJ, a playing song (and the song on air) can't be ejected.",
              ],
              [
                "When a song ends",
                "With the other deck playing, that one simply plays on. With nothing else playing, the other deck's song starts at once — from its cue point, or where it was paused — so the music never stops by itself.",
              ],
            ]}
          />
          <Tip>
            Every control stays in its place; the ones that don&apos;t apply right now (a deck with no song) are greyed out. While the set is
            paused you can still change the mood, the cued song or its Start from; effects wait until something plays.
          </Tip>
        </Section>

        <Section id="jog" title="The jog wheel">
          <Table
            head={["Deck", "What turning it does"]}
            rows={[
              [
                "Loaded or cued (not playing)",
                "Sets where the song will start. It turns like a record — one turn ≈ 1.8 s of the song (hold Shift: a quarter as far), the same feel and scratch sound as a playing song — and the start snaps to the beat when you let go. You hear it scratch on the speakers.",
              ],
              ["Playing (on air, mixing in or playing along)", "Touch it and the song stops under your hand like a record; turn to scratch; let go and it plays on from there."],
              ["Paused", "Moves the spot ▶ will play from — you hear it scratch on the speakers, like a record under your hand — and it stays paused. Press CUE there to make it the cue point."],
            ]}
          />
          <p>The track view, the deck&apos;s time and its overview follow the wheel as you turn it.</p>
          <h3 className="mt-6 text-lg font-semibold">Spinback</h3>
          <p>
            On the song on air, turn the wheel <B>backwards fast</B>; the song spins back like a record and the cued song drops in on its drop.
            Any of these works:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Mouse or one finger:</B> press on the wheel, swipe round anticlockwise fast and let go while still moving.
            </li>
            <li>
              <B>Trackpad:</B> swipe <B>two fingers down</B> fast over the wheel (with the Mac&apos;s usual &quot;natural&quot; scrolling; if
              your scrolling is set the other way, swipe up). It spins back as soon as the swipe is fast enough — no need to lift your fingers.
            </li>
            <li>
              <B>Touchscreen:</B> put two fingers on the wheel and <B>twist anticlockwise</B> fast, then lift them while still turning.
            </li>
          </ul>
          <p>
            It needs about 3 turns a second — a quick flick. Slower is just a scratch, and the song plays on from where you stop. It needs a
            song cued on the other deck. The wheel turns on screen as you go, so you can see which way you&apos;re turning it.
          </p>
          <p className="text-muted">
            A slow two-finger swipe or twist scratches like a drag; a mouse wheel steps one beat per click. Keys work too — see Keyboard and
            mouse.
          </p>
        </Section>

        <Section id="tempo" title="Tempo sliders and Sync">
          <p>
            Each on-air and cued deck has a vertical slider beside its wheel, ±8%. Up is faster. The % button under it (or a double-click)
            goes back to the song&apos;s own tempo.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Song on air:</B> changes its tempo straight away (with key lock on, the key stays put). The auto-DJ re-times the next mix.
            </li>
            <li>
              <B>Cued song:</B> the tempo it settles at after its mix — during the mix it is still beat-matched to the song on air.
            </li>
            <li>The slider moves by itself when the auto-DJ changes the tempo, so it always shows the real speed.</li>
            <li>
              <B>During a mix</B> it works too: the deck goes to that tempo at once (the songs may drift apart — your choice).
            </li>
          </ul>
          <p>
            <B>Sync</B> (under the slider) sets that deck to the other deck&apos;s BPM in one press: on the song on air, to the cued song&apos;s
            tempo; on the cued song, to the song on air&apos;s. It lights up while both decks are at the same BPM (half or double counts, so a
            64 BPM ballad syncs to 128) and is greyed out when they are more than 8% apart. It sets the tempo once — move a slider and they
            drift apart again. (During a mix the auto-DJ beat-matches by itself.)
          </p>
        </Section>

        <Section id="pads" title="Cue pads">
          <p>
            Each deck&apos;s 8 pads in <B>HOT CUE</B> mode (the default) are its cue pads, <B>A–H</B>. They are saved with the song, so they
            are there the next time it plays, and the overview marks them with their letter.
          </p>
          <Dl
            items={[
              [
                "Empty pad (+)",
                "Saves the deck's spot, snapped to the nearest beat: where the song on air is now (or where it is paused), or a cued song's start point — or where its Cue is playing in your headphones.",
              ],
              [
                "Set pad, playing song",
                "Jumps there on the next beat, so the groove carries on in time; the auto-DJ re-times the next mix. While paused it moves the paused spot (CUE there makes it the cue point).",
              ],
              ["Set pad, loaded or cued deck", "Makes that spot the song's start point (it shows as a bar, e.g. \u201cBar 17.1\u201d)."],
              ["Clear", "Shift-click a pad, or press Clear then tap the pad."],
            ]}
          />
          <Tip>Pads work during a mix too, on either deck (the mix carries on), and during a dialogue (the song then plays on without jumping to its drop).</Tip>
        </Section>

        <Section id="loops" title="Loops">
          <p>
            The <B>loop section</B> along the top of each deck: <B>4 BEAT</B> loops 4 beats from the beat the song is on (it then says{" "}
            <B>EXIT</B>: press it to let the song carry on), <B>◀ ½</B> and <B>2× ▶</B> halve or double the loop playing, and <B>IN</B> then{" "}
            <B>OUT</B> loop by hand between two beats. In <B>BEAT LOOP</B> pad mode the 8 pads are loops of <B>¼, ½, 1, 2, 4, 8, 16 and 32
            beats</B>: the lit pad is the loop playing — press another length to change it, or the lit one to let it go.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>On a stopped deck</B> (the cued song, or a paused one) a loop is <B>armed</B> (dashed) from where the song stands — press{" "}
              <B>▶</B> and it comes in looping, for as long as you like. Press <B>Drop</B> to let the loop go and mix.
            </li>
            <li>
              <B>Saved loops</B> (L1–L4, made in the track editor) are the pads in <B>SAVED</B> pad mode. On the song on air, a saved loop
              loops there (if the song is already past it, it jumps there on the beat); on the cued song it is armed, and the song starts from it.
            </li>
            <li>The auto-DJ&apos;s next mix waits while the song on air loops (the cued deck&apos;s row says &quot;After the loop&quot;) and is planned again when it ends.</li>
            <li>
              Pressing <B>Drop</B>, ⏸ or a cue pad ends the loop — loop a few beats, then Drop is a classic build-up.
            </li>
            <li>
              The track view shades a loop that&apos;s playing (dashed edges: armed) and outlines the song&apos;s saved loops. Loops work during
              a mix too (the mix carries on) and during a dialogue (the song then plays on without jumping to its drop).
            </li>
          </ul>
        </Section>

        <Section id="headphones" title="Headphones: Cue and previews">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>🎧 CUE</B> in the mixer, under each channel, plays a loaded or cued deck in your headphones from where it will start. <B>Set start here</B> makes the
              current cue position its start.
            </li>
            <li>
              <B>▶</B> next to each song in the picker plays 30 s of its hook (or drop).
            </li>
            <li>In the track editor, Listen and the beat-grid clicks play on the headphones too.</li>
            <li>
              During a set these only work if <B>Preview &amp; Cue</B> is a different device from the club speakers (otherwise the crowd would
              hear them). A laptop&apos;s jack and its own speakers usually count as one device.
            </li>
          </ul>
        </Section>

        <Section id="volume" title="Volume">
          <p>
            The two knobs at the top of the mixer: <B>MASTER</B> (club speakers — the mix, including scratches) and <B>PHONES</B>{" "}
            (headphones — 🎧 CUE and previews). Drag a knob up or down, scroll on it, or click it and use the arrow keys. Both are saved, and
            the same volumes are sliders under each output on the Library page. Each output&apos;s Test sound plays at its volume.
          </p>
          <p>
            Turning the club volume to 0 is safe: the set keeps running (the booth warns &quot;Volume is at 0&quot;), and it is not mistaken for
            silence. The level meter shows the mix before the volume, so it still moves.
          </p>
        </Section>

        <Section id="desi" title="Desi Night">
          <Steps>
            <li>
              Pick <B>Desi Night</B> <em>before</em> pressing Play.
            </li>
            <li>The set opens with the hook of a slow song from the &quot;Romantic&quot; crate, then drops into the party.</li>
            <li>
              After that each song plays until you press <B>Drop</B> (if nobody does, it mixes out near its end by itself).
            </li>
            <li>
              A song with a marked <B>dialogue</B> plays the dialogue first, then jumps straight to its drop.
            </li>
          </Steps>
          <p>
            Party songs come from the &quot;Bollywood party&quot; and &quot;Punjabi&quot; crates (any song if a crate is empty). Songs at half
            speed are matched with double-speed ones, and two songs too far apart in tempo get a <B>rewind</B> between them. All of this can be
            changed on the Moods page.
          </p>
        </Section>

        <Section id="library" title="Library (admin)">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Music folder</B>: choose it, <B>Allow access</B> again when Chrome asks after a restart, or <B>Rescan</B> for new songs. <B>Add files (this session only)</B> plays files
              without a folder until the page reloads.
            </li>
            <li>
              The <B>track table</B> shows your music folder as it is on disk (<B>Folders</B> view): click a folder to open or close it; each
              folder shows how many songs it has and, while they are being analysed, how many are left and a progress bar. Songs are analysed
              folder by folder. <B>Expand all / Collapse all</B> open or close every folder, searching opens the folders with matches, and{" "}
              <B>List</B> shows every song in one list. Songs added with &quot;Add files&quot; sit in an &quot;Added this session&quot; folder.
            </li>
            <li>
              For every song the table shows its status, BPM, key, drops and gain. Filter by crate or <B>Needs attention</B>{" "}
              (songs whose analysis looks doubtful), and press <B>Edit</B> to fix one.
            </li>
            <li>Decks, Key lock and Audio outputs are described under Before the night.</li>
            <li>
              <B>Settings file in the music folder:</B> the app can keep its settings (decks, key lock, mood edits, volumes) and every
              song&apos;s edits (★ / ⛔, crates, markers, cue pads, saved loops, beat-grid / key / drop fixes) in{" "}
              <span className="font-mono">ai-dj-mixer-settings.json</span> inside your music folder. Press{" "}
              <B>Save settings in the music folder</B> once (Chrome asks to let the app edit files there); after that it&apos;s kept up to date
              automatically. Whenever the folder is opened or rescanned — on this computer or any other — the app reads the file (or any
              of its .json files that is one of ours) and takes it over if it&apos;s newer. Copy the folder to another computer and open it: the
              songs come with their edits. Audio devices aren&apos;t saved (they differ per computer), and songs are matched by their
              content, so renaming or moving them keeps their edits.
            </li>
          </ul>
        </Section>

        <Section id="editor" title="Fixing a track">
          <Dl
            items={[
              ["Playing", "★ Favourite (picked a little more often) or ⛔ Never play (skipped everywhere, even in the picker)."],
              ["Crates", "Your own groups, e.g. “Romantic” or “Punjabi”. Moods can be limited to crates."],
              [
                "Song markers",
                "Cue in, cue out, dialogue start/end and hook start/end, on the song's waveform. Cue in is where the song starts when the auto-DJ brings it in (Start from: Auto); cue out is where it hands over to the next song — the mix is timed so the hand-over lands there — instead of the auto-DJ's own guess (useful for long fade-outs or an outro you never want played). The top strip is the whole song (click to look there, double-click to listen); the big view below shows a few seconds with every beat. Drag a marker's handle to move it; drag the waveform (or swipe on a trackpad) to scroll; click to put the yellow cursor there and listen, then press Set here → Dialogue start / end, Hook start / end, Cue in or Cue out. + zooms in, − out (1× to 16×; hover the level to see the seconds across). Cue in, cue out and the hook snap to the bar; the dialogue is exact. Mark now and the nudge buttons still work, and the analysis suggests a hook and a dialogue — Listen, then Use if it's right.",
              ],
              [
                "Saved loops",
                "Up to 4 per song (L1–L4, amber on the waveform). Put the cursor where it should start and press Save loop at cursor: 1, 2, 4, 8 or 16 bars (it starts on a bar). Drag either edge to adjust it (it stays on the beat), ▶ to listen, ✕ to delete. They show as buttons on the deck whenever the song is loaded, cued or on air.",
              ],
              [
                "Drops",
                "Highlighted bars are the drops. Raise the threshold if breakdowns that keep some bass are missed; lower it if a quiet intro is mistaken for a breakdown.",
              ],
              [
                "Beat grid",
                "Listen: the clicks should land on the kicks, the high click on beat 1. Fix the BPM first (e.g. halve a ballad detected at 128), then nudge the first beat (10 ms or one beat at a time) until it locks.",
              ],
              ["Key", "Automatic (tag, else detected) or set it by hand."],
            ]}
          />
          <Tip>Fixes are kept when the library is re-analysed, and the auto-DJ uses them from the next time it picks the song.</Tip>
        </Section>

        <Section id="moods-page" title="Moods page (admin)">
          <p>
            Tune each mood: its name, tempo and energy range, blend length, when a song leaves (after which drop, or after how many bars),
            Peak-style drop swaps, which crates it plays from, matching genres, automatic effects, and Desi Night&apos;s opener and
            &quot;hold until Drop&quot;. Edits apply from the next transition, even during a set; <B>Reset</B> brings back the preset.
          </p>
        </Section>

        <Section id="history" title="History">
          <p>
            Every song played, grouped by night (a night runs until 6 am), with its time, mood and how it came in. <B>Export night (CSV)</B> or{" "}
            <B>Export all (CSV)</B> for the venue&apos;s licence reports.
          </p>
        </Section>

        <Section id="venue" title="Running it at the venue">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Start it with <Code>npm run build &amp;&amp; npm start</Code> and open Chrome in kiosk mode so it restarts and plays without a
              click after a reboot:
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
                google-chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:3000/booth
              </pre>
            </li>
            <li>
              When Chrome asks about the music folder, choose <B>Allow on every visit</B>.
            </li>
            <li>Once opened, the booth also reloads without internet (the music never needs it).</li>
            <li>
              Wired speakers are safer than Bluetooth: Bluetooth adds a delay (the booth display waits for it) and can drop out without the app
              knowing.
            </li>
            <li>Settings, edits and the history live in this browser on this computer — export the history now and then.</li>
          </ul>
        </Section>

        <Section id="music" title="Where the music comes from">
          <p>
            Only from the club&apos;s own downloaded files. Streaming accounts (Spotify, Apple Music, JioSaavn…) can&apos;t be used: their terms
            forbid mixing and playing in a business, and their audio is locked so the app couldn&apos;t beat-match it anyway.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Buy downloads (Beatport, Beatsource, Bandcamp, the iTunes Store — good for Bollywood and Punjabi) or use a DJ record pool.</li>
            <li>Prefer MP3 at 320 kbps, WAV or FLAC. Choose WAV/FLAC/MP3 rather than AIFF.</li>
            <li>
              Playing music in public also needs the venue&apos;s public-performance licences (in India, typically PPL and IPRS) — the History
              export helps with their reports.
            </li>
          </ul>
        </Section>

        <Section id="keys" title="Keyboard and mouse">
          <Table
            head={["On a jog wheel", "Does"]}
            rows={[
              ["Drag round (mouse or one finger)", "Turn it (Shift = finer)"],
              ["Two-finger swipe (trackpad)", "Turn it: up = forwards, down = back (natural scrolling)"],
              ["Two-finger twist (touchscreen)", "Turn it"],
              ["Mouse wheel", "One beat per click"],
              ["← / →", "One beat back / on (Shift: one bar)"],
              ["Page Down / Page Up", "8 bars back / on"],
              ["Home", "The beginning"],
              ["Fast backward flick / swipe / twist", "Spinback (song on air)"],
              ["Shift-click a cue pad", "Empty that pad"],
            ]}
          />
          <Table
            head={["Elsewhere", "Does"]}
            rows={[
              ["Esc", "Close the track picker"],
              ["Double-click a tempo slider", "Back to the song's own tempo"],
              ["Tab, then Enter / Space", "Every button works from the keyboard"],
            ]}
          />
        </Section>

        <Section id="trouble" title="Troubleshooting">
          <Dl
            items={[
              ["“The browser blocked audio. Press Play”", "Chrome needs one click before it plays sound — press Play. In kiosk mode with the flag above it starts by itself."],
              ["“Allow access to the music folder to start”", "Chrome asks again after some restarts: on Library press Allow access and choose Allow on every visit."],
              ["Play is greyed out", "At least 2 songs must be analysed — open Library and wait for Ready."],
              ["Cue / ▶ preview is greyed out during a set", "Choose a Preview & Cue output different from the club speakers (Library → Audio outputs)."],
              ["Spinback doesn't happen", "Flick faster and let go while still moving; make sure a song is cued on the other deck and no mix is running."],
              ["No sound from the speakers", "Check the Club speakers volume and output (Test sound). If the chosen output is unplugged the booth says so and plays on the computer's own output."],
              ["A song mixes out too early or too late", "Check its drops in the track editor (raise the threshold), or adjust the mood's “Leave after drop” on the Moods page."],
            ]}
          />
        </Section>
      </article>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-4">
      <h2 id={`${id}-title`} className="border-b border-border pb-2 text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm">{children}</code>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-accent">{children}</ol>;
}

function Tip({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">{children}</p>;
}

function Dl({ items }: { items: [string, string][] }) {
  return (
    <dl className="divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map(([term, text]) => (
        <div key={term} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="font-semibold">{term}</dt>
          <dd className="text-muted">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wider text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) => (
                <td key={i} className={`px-4 py-2 ${i === 0 ? "font-semibold" : "text-muted"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
