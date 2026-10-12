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
   Each track is analysed once (tempo, beat grid, energy); keys are read from file tags.
2. Optionally set **Decks** to 2, 3 or 4.
3. **Booth** → pick a mood → **Play**. Change the mood any time; the music never stops.

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

## Development

```bash
npm run check   # typecheck + lint + unit tests
npm run build
```

See `AGENTS.md` for the architecture and the rules AI coding agents (and humans) should follow.
