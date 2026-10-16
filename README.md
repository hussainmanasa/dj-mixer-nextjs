# AI DJ Mixer

A plug-and-play auto-DJ for clubs. Pick a mood, press play — the app chooses, beat-matches and blends every
track from your own downloaded music library, with no one at the decks.

## Requirements

- Node.js 20.9 or newer
- **Chrome or Edge on a computer** for the booth (folder access uses the File System Access API)

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000, then:

1. **Library** → *Choose music folder* and pick the folder with your tracks (MP3, M4A/AAC, WAV, FLAC, Ogg).
   Each track is analysed once (tempo, beat grid, drops, loudness, key — tags win over detection).
2. Optionally set **Decks** to 2, 3 or 4, and under **Audio outputs** choose the club speakers (e.g. Bluetooth or
   the 3.5 mm jack) and a separate **Preview & Cue** output for headphones (e.g. USB-C or HDMI).
3. **Booth** → pick a mood → **Play**. Change the mood any time; the music never stops.
   Before pressing Play you can **Load track** into any deck (Deck A plays first, then B, C, D) and pick where
   each starts with **Start from**; the auto-DJ takes over after them.
4. Optional, while it plays: **Drop** brings the next track in on its drop; **Effects** (Echo, Filter, Reverb,
   Riser) fire on the next beat; **Change track** / **Add track** request music. The auto-DJ still
   beat-matches and mixes every request for the mood, and in moods with *Add effects on transitions* it fires
   effects itself as the music changes (the FX pad lights up, marked "auto").
   **🎧 CUE** in the mixer plays a loaded or cued deck in your headphones (the preview output); **Set start here** makes
   that its start. The picker's **▶** previews a song before you choose it. On a loaded or cued deck you can
   also turn the **jog wheel** (drag, scroll, or click it and use the arrow keys) to move its start point — it
   scratches on the club speakers as you turn it (during a set, over the music).
   **Laid out like a Pioneer DDJ-FLX4**: Deck A · mixer · Deck B under the "screen" (moods, track view, Up next,
   queue). Each deck has the loop section (IN, OUT, 4 BEAT / EXIT, ½, 2×) and BEAT SYNC on top, a display, the jog
   wheel with its tempo slider, round CUE and ▶ / ⏸ buttons, and 8 pads with modes HOT CUE / BEAT LOOP (¼–32 beats) /
   SAVED. The mixer has MASTER and PHONES volume knobs around the set's Play / Stop, LOAD per deck, AI DJ, Drop, Beat FX,
   🎧 CUE per channel, and TRIM / HI / MID / LOW / CFX knobs, channel faders with level meters and a crossfader that
   move by themselves to show what the auto-DJ is doing (staff don't mix by hand).
   **Every deck is a plain player** — CUE, ▶ / ⏸, loops, cue pads, tempo and the jog wheel work on any deck with a
   song, at any time, AI DJ on or off, also in the middle of the auto-DJ's own mix (it lets go and both songs play
   on). **▶ Play / ⏸ Pause** is one button: ⏸ stops just that deck and nothing changes by itself; with nothing else
   playing the club hears nothing until ▶. ▶ on the cued deck plays it at once, at full level, together with the
   song on air (beat-matched when their tempos allow; on its own if the song on air is paused); nothing mixes or
   swaps by itself — only **Drop** mixes them. Before the set, ▶ on a loaded deck starts the set with that song.
   **CUE** works like a CDJ's: playing, it goes back to the cue point and stops; stopped elsewhere, that spot becomes
   the cue point; at the cue point, it plays while held (▶ meanwhile keeps it playing). When a song ends with nothing
   else playing, the other deck's song starts at once, so the music never stops by itself.
   The **jog wheel** works like a record on every deck (one turn ≈ 1.8 s of the song): on the song on air touch it and
   the song stops under your hand, turn it to scratch, let go and it plays on; on a paused song it moves the spot ▶
   plays from — scratching on the club speakers either way. Flick it **backwards fast** and let go for a
   **spinback** (or swipe two fingers down fast on a trackpad, or twist two fingers back on a touchscreen): the song
   spins back and the cued song drops in. The wheel's centre shows the song's cover art.
   **Tempo slider** beside each deck's wheel (±8%) changes that deck's tempo; double-click it, or press its %
   button, for the song's own tempo. **Sync** under it sets that deck to the other deck's BPM. **Cue pads A–H**: an
   empty pad saves the spot, a set pad jumps there on the beat (on a cued deck it sets the start); Shift-click or
   Clear empties one. **Loop** buttons (¼–16 beats) repeat that many beats on the beat until you press it again; on
   a stopped deck (cued or paused) a loop is armed and the song comes in looping when you press ▶, until Drop. **Saved
   loops** (L1–L4, made on the song's waveform in the track editor) are one tap on the deck.
   The **AI DJ** switch under Play / Stop: on, the auto-DJ mixes songs you leave alone (a song you played, paused
   or cued plays to its end, then the next one starts); off, it never mixes — each song plays to its end and the
   cued one starts after it (mix by hand with Drop or ▶); it stays off until you switch it on. The auto-DJ keeps
   running throughout — no need to press Stop. Every control stays in its place (greyed out when it doesn't
   apply), so the booth never jumps.
   **Track view** above the decks shows the songs one below another: a scrolling waveform with the beat grid,
   bar numbers, phrases, drops, cue pads and the mix point, plus BPM, key, time, bar/beat and phrase — during a
   mix you can watch both songs' beats line up.
   **Volume**: the mixer's **MASTER** knob (club speakers, the mix) and **PHONES** knob (headphones: 🎧 CUE and
   previews) — drag, scroll or arrow keys. Both are saved and are also sliders under each output in Library → Audio outputs.

The **Help** page in the app (`/help`) explains every control in plain words for booth staff and the venue admin.

## Running at a venue

```bash
npm run build && npm start
```

Launch Chrome in kiosk mode so the booth restarts and plays without a click after a reboot:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:3000/booth
```

When Chrome asks for access to the music folder, choose **Allow on every visit**.

## Licensing

Only use tracks the club is licensed to play in public (DJ pools or stores whose terms allow DJ use), and keep
the venue's public performance licences current (in India, for example, PPL and IPRS).

## Admin

- **Library** — folder, analysis, deck count and key lock (beta). Press **Save settings in the music folder** once
  and the app keeps `ai-dj-mixer-settings.json` there (settings and every song's edits); open the folder on any
  computer and they come back. The track table shows your music folder as it is
  (folders and subfolders that open and close, with song counts and analysis progress; or a plain List). Every setting applies straight away, also
  during a set and from another browser tab — no refresh or Stop needed. The track table flags problems
  (*Needs attention*); **Edit** a track to mark it *Favourite* / *Never play*, add it to crates, fix its beat grid
  (listen with clicks), its drop detection or its key.
- **Moods** — tune each mood's tempo, energy, blend length, how long tracks play, drop swaps, crates, the set
  opener and "hold until Drop".
- **Song markers** (track editor) — on the song's waveform: drag the dialogue / hook / start handles, or click to
  put the cursor there (and listen) and press **Set here**; zoom in to place them exactly. The analysis also
  *suggests* a hook and a dialogue (listen, then **Use**), and *Mark now* still works while the song plays. Used by Drop and **Desi Night**.

## Desi Night

Pick **Desi Night** before pressing Play: the set opens with the hook of a slow song from the *Romantic* crate,
then drops into the party (a marked dialogue plays first, then the drop). After that each song plays until
you press **Drop**. On the cued deck, **Start from** chooses how the next song comes in (Auto, Beginning,
Dialogue, Hook, Drop, or tap a bar). Songs at half speed are beat-matched (a 64 BPM ballad with a 128 BPM
track), and when two songs are too far apart in tempo the old one **rewinds** before the next one hits.
- **History** — every track played, by night; export CSV for your licence reports.

## Development

```bash
npm run check   # typecheck + lint + unit tests
npm run build
npm run e2e     # end-to-end tests on the build (first time: npx playwright install chromium)
```

See `AGENTS.md` for the architecture and the rules AI coding agents (and humans) should follow.
