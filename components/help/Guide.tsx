import Link from "next/link";
import type { ReactNode } from "react";

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
        <ol className="space-y-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-foreground">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
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
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>Mood</B> buttons along the top.
            </li>
            <li>
              <B>Decks</B> on each side: a spinning jog wheel with the song&apos;s cover art, its tempo slider, a volume bar and bass light, the
              title, key, BPM and time, and the song&apos;s overview (green blocks = full sections, gaps = breakdowns, ⚑ = where it will start).
              The badge says what the deck is doing: <B>On air</B>, <B>Cued</B> (comes in next), <B>Mixing in / out</B>, <B>Paused</B>,{" "}
              <B>Standby</B> (spare song), <B>Loaded</B> (before Play) or <B>Empty</B>.
            </li>
            <li>
              In the middle: <B>Play / Stop</B>, <B>Drop</B>, <B>Layer</B>, the <B>Effects</B> pad, the level meter, <B>Volume</B>, the bar &amp;
              phrase counter, <B>Up next</B> (which song, how it mixes, and when) and the request <B>Queue</B>.
            </li>
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
            Both rows use the same time scale, so during a mix you can watch the two songs&apos; beats land on the same lines. <B>− / +</B>{" "}
            zooms (4, 8, 16 or 32 seconds across). A song&apos;s detailed waveform is prepared the first time it is on a deck (until then you see
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
            The <B>AI DJ</B> switch under Play / Stop (during a set) decides who mixes. <B>On</B> (normal): the auto-DJ mixes every song in
            by itself. <B>Off</B>: it still picks the best next song and cues it, but it doesn&apos;t mix by itself — Up next says{" "}
            <B>waits for Drop</B>, and you bring it in with <B>Drop</B> (or <B>▶ Play now</B>), still beat-matched for you.
          </p>
          <p>
            If nobody mixes and the song nears its end, the AI DJ brings the cued song in by itself and switches back <B>on</B> (&quot;AI DJ is
            back on&quot;), so the music never stops. Switching it on again at any time hands the mixing back.
          </p>
        </Section>

        <Section id="load" title="Loading decks before Play">
          <p>
            Before pressing Play you can choose the first songs yourself: <B>Load track</B> on a deck, pick a song. Deck A plays first, then
            B, C, D in order; after them the auto-DJ carries on. <B>Change</B> or <B>Eject</B> to undo.
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
                "Brings the next song in on its drop, on the next 4-bar phrase (about 6–13 s), with a build-up and a riser. Greyed out while a mix is already running.",
              ],
              [
                "Layer…",
                "Plays the next song over the current one (its bass off) until you press Drop, which swaps them. Only for songs that match in tempo and key; otherwise it offers the songs that do.",
              ],
              [
                "Effects",
                "Echo, Filter, Reverb and Riser on the whole mix, starting on the next beat (the riser on the next bar). In Groove, Peak Hour and Desi Night the auto-DJ also adds effects itself as songs change — the pad lights up, marked “auto”.",
              ],
              [
                "Change track",
                "On the cued deck: choose the song that comes in next. The picker lists the best fits for the mood first (▶ previews a song on the headphones; “tempo jump” means it will echo out rather than blend).",
              ],
              ["Add track / Queue", "Requests that play after the next song, in order. Remove one with ✕. The queue survives a reload."],
              ["Up next", "The next song, how it will mix in, and the countdown to the mix (then its progress)."],
            ]}
          />
          <Tip>Every request still goes through the auto-DJ: it beat-matches it, picks the transition and steers back to the mood afterwards.</Tip>
        </Section>

        <Section id="decks" title="Deck controls">
          <Dl
            items={[
              [
                "⏸ Pause (song on air)",
                "The song fades out instantly and the club hears nothing until you press ▶ Resume — for an announcement, a speech or the cake. A yellow Paused banner shows the whole time. Nothing restarts by itself.",
              ],
              ["▶ Resume", "Carries on from exactly where it stopped, at the same tempo, and the auto-DJ plans the next mix again."],
              [
                "▶ Play now (cued deck)",
                "Starts the cued song on the next phrase, beat-matched, playing together with the song on air (its bass stays off so the two basslines don't clash). Nothing mixes out until the new song reaches its drop — then they swap — or you press Drop. Songs too far apart in tempo to play in time get mixed in instead, and a song set to start from its drop swaps straight in. While the set is paused, ▶ Play now starts that song at once instead of resuming the old one.",
              ],
              [
                "⏸ during a mix",
                "Stops just that deck; the other song carries on at full level. Pause the song going out and the new one takes over; pause the song coming in and it comes back near the end of the current song (or press ▶ Play now).",
              ],
            ]}
          />
          <Tip>While paused you can still change the mood, change the cued song or its Start from. Drop, Layer and effects wait until you resume.</Tip>
        </Section>

        <Section id="jog" title="The jog wheel">
          <Table
            head={["Deck", "What turning it does"]}
            rows={[
              [
                "Loaded or cued (not playing)",
                "Sets where the song will start. 1 turn = 4 bars (hold Shift: 1 bar). You hear it scratch on the speakers (not while the set is paused).",
              ],
              ["On air, playing", "Touch it and the song stops under your hand like a record; turn to scratch; let go and it plays on from there."],
              ["On air, paused", "Moves the spot ▶ Resume will play from, silently (the room stays quiet); it stays paused."],
              ["Mixing", "No wheel — turning it would throw both songs out of time."],
            ]}
          />
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
            <li>It is greyed out while that deck&apos;s mix is about to start or running.</li>
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
            Each loaded, cued and on-air deck has 8 pads, <B>A–H</B>. They are saved with the song, so they are there the next time it plays,
            and the overview marks them with their letter.
          </p>
          <Dl
            items={[
              [
                "Empty pad (+)",
                "Saves the deck's spot, snapped to the nearest beat: where the song on air is now (or where it is paused), or a cued song's start point — or where its Cue is playing in your headphones.",
              ],
              [
                "Set pad, song on air",
                "Jumps there on the next beat, so the groove carries on in time; the auto-DJ re-times the next mix. While paused it moves the paused spot.",
              ],
              ["Set pad, loaded or cued deck", "Makes that spot the song's start point (it shows as a bar, e.g. \u201cBar 17.1\u201d)."],
              ["Clear", "Shift-click a pad, or press Clear then tap the pad."],
            ]}
          />
          <Tip>The pads on the song on air wait while it mixes (jumping then would throw both songs out of time), and during its dialogue.</Tip>
        </Section>

        <Section id="loops" title="Loops">
          <p>
            The song on air has <B>Loop</B> buttons: <B>¼, ½, 1, 2, 4, 8, 16 beats</B>. Press one and the song repeats that many beats,
            starting on the beat it&apos;s in, so it stays in time. The lit button is the loop playing: press another length to change it, or
            press the lit one (or <B>Exit loop</B>) to let the song carry on from there.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>On the cued deck</B> too: before it plays, a loop is <B>armed</B> (dashed) from where the song will start — press{" "}
              <B>▶ Play now</B> and it comes in looping its intro while the song on air plays on, for as long as you like. Press{" "}
              <B>Drop</B> to let the loop go and mix. While it plays along you can also start or change a loop on it.
            </li>
            <li>
              <B>Saved loops</B> (L1–L4) appear as buttons under the loop lengths when the song has them. On the song on air, a saved loop
              loops there (if the song is already past it, it jumps there on the beat); on the cued song it is armed, and the song starts from it.
            </li>
            <li>The auto-DJ&apos;s next mix waits while the song on air loops (Up next says &quot;After the loop&quot;) and is planned again when it ends.</li>
            <li>
              Pressing <B>Drop</B>, <B>▶ Play now</B> or a cue pad ends the loop — loop a few beats, then Drop is a classic build-up.
            </li>
            <li>
              The track view shades a loop that&apos;s playing (dashed edges: armed) and outlines the song&apos;s saved loops. Loops wait while the
              song is mixing, paused or still in its dialogue. If the song on air nears its end while the cued song loops, they swap by
              themselves so the music never gets stuck.
            </li>
          </ul>
        </Section>

        <Section id="headphones" title="Headphones: Cue and previews">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <B>🎧 Cue</B> on a loaded or cued deck plays it in your headphones from where it will start. <B>Set start here</B> makes the
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
            Under the level meter: <B>Club speakers</B> (the mix, including scratches) and <B>Headphones</B> (Cue and previews). Both are
            saved, and the same sliders are under each output on the Library page. Each output&apos;s Test sound plays at its volume.
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
                "Cue in, cue out, dialogue start/end and hook start/end, on the song's waveform. Cue in is where the song starts when the auto-DJ brings it in (Start from: Auto); cue out is where it hands over to the next song — the mix is timed so the hand-over lands there — instead of the auto-DJ's own guess (useful for long fade-outs or an outro you never want played). The top strip is the whole song (click to look there, double-click to listen); the big view below shows a few seconds with every beat. Drag a marker's handle to move it; drag the waveform (or swipe on a trackpad) to scroll; click to put the yellow cursor there and listen, then press Set here → Dialogue start / end, Hook start / end, Cue in or Cue out. − / + zooms (2–32 s). Cue in, cue out and the hook snap to the bar; the dialogue is exact. Mark now and the nudge buttons still work, and the analysis suggests a hook and a dialogue — Listen, then Use if it's right.",
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
