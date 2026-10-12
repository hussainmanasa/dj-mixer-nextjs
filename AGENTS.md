<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI DJ Mixer — instructions for AI coding agents

A plug-and-play auto-DJ web app for clubs. Staff pick a **mood** and press **play**; the app chooses every
track, beat-matches it and blends it with no human at the decks.

Full product plan: https://claude.ai/code/artifact/903692c7-9f12-49a9-9de1-5a82b3dba9f3

## Product decisions (do not change without the project owner)

1. **Audio comes only from the club's own downloaded library** — a local folder opened with the File System
   Access API. Never add Spotify, Apple Music or any streaming SDK: Spotify's Developer Policy bans mixing its
   content and playing it from a business.
2. **No human intervention in the mix.** The booth exposes only the mood picker and Play/Stop. Do not add
   skip, lock, crossfader, energy slider or track-choice controls to the booth. Admin features live on
   `/library` and `/moods`.
3. **Mood changes only when staff pick a new one.** Never switch moods on a schedule.
   A mood change must never cut the music: re-plan only transitions that haven't started; close moods ease
   over 1–3 tracks, far tempo jumps use an echo-out (`isMoodJump`).
4. **2 decks by default, configurable 2–4** (`MIN_DECKS` / `MAX_DECKS` in `lib/types.ts`).
5. **The auto-DJ is rule-based.** An LLM (e.g. Claude) is an optional, later, off-by-default add-on. If added it
   runs only in a server route, returns schema-validated JSON, has a short timeout, falls back to the rules,
   and is never in the audio path.
6. **The music must never stop.** Keep every fail-safe working: silence watchdog, early-end recovery,
   decode-failure skip, standby deck (3+ decks), auto-resume after reload.
7. **Licensing:** no AGPL/GPL dependencies (e.g. essentia.js is AGPL — don't add it). Prefer MIT/Apache/BSD.

## Architecture

```
app/
  (kiosk)/booth/page.tsx      booth screen (server page → <Booth/> client component)
  (admin)/library/page.tsx    music folder, analysis progress, deck count
  (admin)/moods/page.tsx      read-only mood presets
  manifest.ts                 PWA manifest (kiosk install)
components/                   UI (client components)
lib/
  types.ts                    shared domain types — no browser APIs
  analysis/
    bpm.ts                    PURE: tempo, beat grid, downbeat, energy, intro/outro
    key.ts                    PURE: key tag → Camelot, harmonic compatibility
    analyze.ts                client: decode at 11 025 Hz → worker
    analyze.worker.ts         Web Worker running bpm.ts
  dj/
    moods.ts                  PURE: mood presets + energy target curve
    selector.ts               PURE: score/rank tracks, choose transition type
    mixpoints.ts              PURE: phrase-aligned mix-out / cue-in points
    autodj.ts                 client: the orchestrator (plans, schedules, recovers)
  audio/
    timeline.ts               PURE: context time ↔ track position under rate ramps
    deck.ts                   client: source → 3-band EQ → filter → fader (+ echo send)
    engine.ts                 client: N decks → master → limiter → analyser → out
    transitions.ts            client: blend, filterSweep, echoOut, cut automation
  library/
    scan.ts                   client: folder walk, content hash ids, tag reading
    store.ts                  client: IndexedDB persistence (idb-keyval)
store/
  library.ts                  zustand: tracks, folder, settings, analysis queue
  session.ts                  zustand: owns the single AutoDJ, mirrors its status
types/fs-access.d.ts          File System Access API typings
```

How a transition works: `AutoDJ.planNext()` picks the next track (`selector.ts`), decodes it, computes the
mix-out on the current track's grid (`mixpoints.ts`), converts it to context time (`timeline.ts`), applies a
recipe (`transitions.ts`) and starts the incoming deck at `playbackRate = outgoingBpm / incomingBpm`. After the
blend the incoming deck's rate glides back to 1.0 over 16 bars. `handover()` runs when the transition ends.

## Rules for audio code

- **Schedule every sound on the AudioContext clock** (`start(when)`, `setValueAtTime`, ramps). Never trigger
  audio from `setTimeout`/`setInterval`; JS timers are only for planning and hand-over.
- **Change playback rate only via `Deck.rampRate()`** so `PlaybackTimeline` stays in sync. Beat alignment
  depends on it.
- `BiquadFilterNode.type` can't be scheduled — switch it immediately at an inaudible cut-off, then schedule
  the frequency sweep (see `filterSweep`).
- Memory: a decoded stereo track is ~10 MB per minute. Decode only the next track (plus one standby with 3+
  decks) and `unload()` decks after hand-over. Analysis decodes at 11 025 Hz and drops the buffer.
- Keep CPU-heavy work (analysis) in the Web Worker, never on the main thread.

## Code conventions

- TypeScript strict. Keep logic in the **PURE** modules above (no `window`, `AudioContext`, `indexedDB`) and
  unit-test it with Vitest next to the file (`*.test.ts`). Browser-only modules are imported only from
  client components (`"use client"`).
- Pages are server components that render client components. Next.js 16 here runs with `cacheComponents`
  and `partialPrefetching`: previously visited routes stay mounted but hidden, so don't rely on unmount for
  cleanup of global audio state (the AutoDJ lives in `store/session.ts`, not in a component).
- State: zustand (`useLibrary`, `useSession`). UI never talks to `AudioEngine` directly.
- Styling: Tailwind CSS v4 with the dark tokens in `app/globals.css`; `.btn` and `.btn-primary` for buttons.
  The booth must stay readable on a dim screen from a distance: big targets, high contrast.
- Tune selection by changing `WEIGHTS` / thresholds in `selector.ts` and update the tests with the intent.

## Commands

```bash
npm run dev        # http://localhost:3000 (redirects to /booth)
npm run check      # typecheck + lint + unit tests — run before finishing any change
npm run build      # production build — must pass
```

Browser testing: the Library page has an **"Add files (this session only)"** input
(`data-testid="session-files"`) that Playwright can fill without a folder picker. Launch Chromium with
`--autoplay-policy=no-user-gesture-required` so audio starts without a click.

## Known limitations / next steps

- Tempo sync uses `playbackRate`, which also shifts pitch (up to ±8% ≈ 1.3 semitones). Next: key-lock
  time-stretch in an AudioWorklet (check the licence first — SoundTouch ports are LGPL).
- Musical key comes only from file tags (`TKEY` etc.); no audio key detection yet.
- The 4th deck is allocated but layered (overlapping) blends are not implemented yet.
- No server side yet: Postgres + Drizzle, Auth.js email magic link for the venue admin, and optional R2 backup
  are planned. Analysis currently lives in the browser's IndexedDB.
- Offline caching beyond the PWA manifest (service worker) is not implemented.
