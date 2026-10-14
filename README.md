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
   **Layer** plays the next song over the current one (its bass off) until you press **Drop**, which swaps
   them — only for songs that match in tempo and key.
   **🎧 Cue** on a loaded or cued deck plays it in your headphones (the preview output); **Set start here** makes
   that its start. The picker's **▶** previews a song before you choose it.

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

- **Library** — folder, analysis, deck count and key lock (beta). The track table flags problems
  (*Needs attention*); **Edit** a track to mark it *Favourite* / *Never play*, add it to crates, fix its beat grid
  (listen with clicks), its drop detection or its key.
- **Moods** — tune each mood's tempo, energy, blend length, how long tracks play, drop swaps, crates, the set
  opener and "hold until Drop".
- **Song markers** (track editor) — the analysis *suggests* a hook and a dialogue (listen, then **Use**), or mark
  them yourself while the song plays (*Mark now*); try the dialogue → drop. Used by Drop and **Desi Night**.

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
