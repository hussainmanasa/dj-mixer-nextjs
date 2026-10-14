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
2. **Staff steer, the auto-DJ mixes.** Owner decisions of 13 Oct 2026 allow exactly these booth actions:
   mood picker, Play/Stop, **Drop** (bring the next track in on its drop), **effects** (Echo, Filter, Reverb,
   Riser on the master FX chain), **track requests** (choose the cued deck's track, or queue tracks), from
   14 Oct 2026 **Start from** on the cued deck (Auto / Beginning / Dialogue / Hook / Drop, or tap a bar),
   **loading songs into decks before Play** (each with its Start from; the auto-DJ takes over after them), and
   **Layer** (two songs together until Drop swaps them; only songs that match in tempo and key), and **Cue /
   preview** on a separate output (headphones): Cue a loaded or cued deck and "Set start here", preview songs in
   the picker. Cue never touches the mix.
   Every action goes through `AutoDJ`: it still beat-matches, chooses the transition, times it on the grid
   and steers back to the mood. Do not add manual decks, crossfader, per-deck EQ/faders, jog control,
   skip/seek, energy slider or tempo controls, and never let UI write to deck automation directly.
   Admin features live on `/library` and `/moods`.
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
  (admin)/library/page.tsx    music folder, analysis, deck count, key lock, track table + editor
  (admin)/moods/page.tsx      mood editor (presets + admin edits)
  (admin)/history/page.tsx    set log by night, CSV export
  manifest.ts                 PWA manifest (kiosk install)
components/                   UI (client components)
  AppShell.tsx                service worker registration + offline banner (root layout)
  booth/                      Booth.tsx (layout, Drop, queue) · DeckPanel · JogWheel · TrackOverview · FxPad ·
                              TrackPicker · frame.ts (per-frame loop)
  library/                    LibraryManager · TrackTable (filters, issues) · TrackEditor (flags, crates, fixes)
  moods/MoodEditor.tsx · history/History.tsx
lib/
  types.ts                    shared domain types — no browser APIs
  analysis/
    bpm.ts                    PURE: tempo, beat grid (or an admin-forced grid), energy, intro/outro, bar levels
    structure.ts              PURE: breakdowns and drops from per-bar bass levels
    loudness.ts               PURE: BS.1770-style integrated loudness, library target, trim
    keydetect.ts · fft.ts     PURE: key from audio (chromagram × Krumhansl–Kessler profiles)
    suggest.ts                PURE: suggested hook (repetition) and dialogue (speech before the beat)
    key.ts                    PURE: key tag → Camelot, harmonic compatibility
    analyze.ts                client: decode at 11 025 Hz → worker
    analyze.worker.ts         Web Worker running bpm.ts
  dj/
    moods.ts                  PURE: mood presets + energy target curve
    selector.ts               PURE: score/rank tracks, choose transition type
    mixpoints.ts              PURE: structure-aware mix-out / cue-in points
    cues.ts                   PURE: song markers (dialogue, hook, default start), entries, opener window
    autodj.ts                 client: the orchestrator (plans, schedules, recovers)
  audio/
    timeline.ts               PURE: context time ↔ track position under rate ramps and one jump
    deck.ts                   client: source → trim → 3-band EQ → filter → fader → out [→ key-lock]
    engine.ts                 client: N decks → master → effects → limiter → analysers (meter, watchdog) → out
    transitions.ts            client: blend, filterSweep, echoOut, cut, dropIn, dialogueIn automation
    fx.ts                     client: staff effects on the master (echo, filter, reverb, noise riser)
    keylock.ts                client: loads public/worklets/keylock.js (phase-vocoder pitch corrector)
    outputs.ts                client: list output devices, route an AudioContext (setSinkId), test tone
  library/
    scan.ts                   client: folder walk, content hash ids, tag reading
    store.ts                  client: IndexedDB persistence (idb-keyval): tracks, settings, session, set log
    setlog.ts · issues.ts     PURE: nights + CSV for licence reports; library health checks
    preview.ts                client: the shared preview player (editor, booth Cue, picker) on the preview output
store/
  library.ts                  zustand: tracks, folder, settings, analysis queue
  session.ts                  zustand: owns the single AutoDJ, mirrors its status
  preview.ts                  zustand: the shared preview player (one preview at a time)
types/fs-access.d.ts          File System Access API typings
public/sw.js                  service worker (offline app shell)
public/worklets/keylock.js    key-lock AudioWorklet (plain JS; DSP unit-tested in lib/audio/keylock.test.ts)
e2e/                          Playwright tests against the production build, with generated fixture tracks
```

How a transition works: `AutoDJ.planNext()` picks the next track (`selector.ts`), decodes it, computes the
mix-out on the current track's grid (`mixpoints.ts`), converts it to context time (`timeline.ts`), applies a
recipe (`transitions.ts`) and starts the incoming deck at `playbackRate = outgoingBpm / incomingBpm`. After the
blend the incoming deck's rate glides back to 1.0 over 16 bars. `handover()` runs when the transition ends.

How long a track plays: like a club DJ, the auto-DJ does **not** play tracks to the end. Analysis stores a bass
level per bar (`TrackAnalysis.barLevels`); `structure.ts` turns that into sections, and a *drop* is a full
section that returns after a breakdown. `mixOutPoint()` leaves the track when it breaks down after the mood's
`mixOutAfterDrops`-th drop, starting the transition `leadBars` early so the hand-over (a blend's bass swap) lands
on the breakdown. Tracks with no breakdowns leave after the mood's `maxPlayBars`; tracks with fewer drops than
the mood wants, or analysed before `ANALYSIS_VERSION` 2, fall back to mixing out over the outro.
Bump `ANALYSIS_VERSION` (`bpm.ts`) when `TrackAnalysis` gains fields: the Library page re-analyses older
tracks in the background and they stay playable meanwhile.

Booth display: the booth shows every deck as the auto-DJ runs it — spinning jog wheel (turns with the track
position, so tempo sync is visible), beat ring, fader and bass meters, track overview with drops and the next
mix point, bar/phrase counter, and a mood-coloured background that pulses on the beat. It is **display only**
(decision 2 still holds). `useBoothFrame()` (`components/booth/frame.ts`) runs one requestAnimationFrame loop,
reads `AutoDJ.snapshot()` once per frame and widgets write to the DOM through refs, so React never re-renders
per frame. `AudioParam.value` gives the live, automated fader/EQ values. The beat pulse is off under
`prefers-reduced-motion`. Play/Stop is disabled while starting ("Starting…", spinning ring) and while
stopping ("Stopping…", ring draining over `STOP_FADE_SECONDS`); `useSession.stop()` also ignores repeat calls
(`stopping` flag), so a double press can never re-stop or restart the set. Drop, effects and track choice are
disabled during the fade-out.

Drop button: `AutoDJ.drop()` re-plans the next transition (reusing the already-decoded next track) as a
`"drop"` transition — a drop swap (`dropIn` in `transitions.ts`). The incoming drop (`dropCue()`: its first
drop, else end of intro, else first downbeat) lands on the outgoing track's first 4-bar boundary at least
`SCHEDULE_MARGIN` + 2 bars ahead (≈6–13 s at 128 BPM). The incoming deck starts 2–8 bars earlier
(`dropBuildBars()`), beat-matched, rising under a falling high-pass with its bass killed while a rising
high-pass thins the outgoing track and its fader eases to 70%; on the drop the incoming bass and full range
hit together while the outgoing keeps playing in time and fades out over `DROP_FADE_BARS` (2) bars, its
high-pass rising to 2 kHz so its kick and bass never double the new drop. Tempos too far apart to sync (or
low-confidence grids) get no build and no fade (overlapping would clash): a cut onto the drop with an echo
tail. `handover()` calls `Deck.clearFilter()` to return the new live deck to all-pass. Ignored while
a transition is running or under `SCHEDULE_MARGIN` away. The booth button takes `disabled` from React state,
not a DOM write: React drops `onClick` when the *prop* says disabled.

Effects: `MasterFx` sits between the master gain and the limiter, so it can never cancel the decks'
transition automation. `AutoDJ.fx(kind)` starts the effect on the live deck's next beat (the riser on the
next downbeat, running 4 bars) via `nextBoundary()`; effects use `cancelAndHoldAtTime` so re-firing restarts.

Track requests: `AutoDJ.request(track, next)` keeps a queue that `loadNextTrack(…, useRequests)` drains before
the selector's own picks (the selector never picks a queued track; the standby deck never takes one).
`next` replaces the cued track if its mix hasn't started. A request is never lost on re-plan: mood change,
Drop and recovery put it back in the queue. After a requested track outside the mood's tempo band, `jump` is
set so the next pick steers back into the mood. The picker ranks every analysed track with
`rankForRequest()` (same score as the auto-DJ, recently played last, off-tempo flagged).

Volume matching: analysis measures integrated loudness (`loudness.ts`, on the 11 kHz mono analysis signal —
our own scale, not true LUFS). `Deck.load(track, buffer, target)` sets the deck's `trim` gain to bring the
track to the **library's median loudness** (`libraryLoudness`), capped at −12…+6 dB; the typical track plays
unchanged. A fixed target would push a whole quiet library to the boost cap.

Key: set by hand (`overrides.key`) → else the file's tag → else detected from the audio (`keydetect.ts`).
`withAnalysis()` (store/library.ts) applies that order and keeps the tag key in `tagKey`.

Key-lock (Library setting, off by default, "beta"): every deck's `out` goes through an AudioWorklet that shifts
pitch by `1/playbackRate` (phase vocoder, N = 2048, hop N/8, phase reset on transients, exact pass-through at
pitch 1). Its delay is a constant `KEYLOCK_DELAY_SAMPLES` on every deck, so decks stay aligned; it sits after
the faders so transition automation still lands on the beat. `engine.outputDelay` is that delay: the booth
display and master effects add it (what the room hears lags the deck clock). Falls back to no key-lock if the
worklet can't load. Takes effect at the next Play. The booth shows a **KEY LOCK** badge on each deck only when
it is actually running (`AutoDJStatus.keyLock`), and labels the rate change "tempo ±x%" — key-lock keeps the
pitch, not the tempo, so the percentage still moves while beat-matching.

Drop extras: a staff Drop with a build-up also fires a noise riser that peaks exactly as the drop hits
(`MasterFx.riserBetween`), cancelled if the Drop is re-planned. Moods with `dropSwap` (Peak Hour) turn their
planned blends into drop swaps landing where the blend's bass swap would have (the breakdown); a staff Drop
still pulls such a swap forward (`Planned.staffDrop`).

Set log: `onPlayed` (AutoDJ dep) records every track that starts — set start, each transition, recoveries — in
IndexedDB (`appendSetLog`, capped at 20 000). `/history` groups by night (6 am cut-over) and exports CSV.

Saved queue: the request queue is saved with the last session whenever it changes and restored on hydrate
(tracks that are gone or not ready are dropped), so auto-resume keeps the staff's requests. The picker leaves
out the playing, cued and already-queued tracks.

Offline: `public/sw.js` caches `/_next/static` (cache-first), pages and RSC (network-first) and other assets
(stale-while-revalidate); registered only in production. `experimental.useOffline` powers the banner. A
reload or reboot works offline for any page opened before; in-app navigation waits until the network is back.

Library admin: never-play / favourite flags (`selector.playable`, `WEIGHTS.favourite`), crates (moods can be
limited to crates; empty crates fall back to the whole library), "Needs attention" (`issues.ts`), and per-track
fixes in `TrackEditor`: beat grid (re-analysed on the forced grid, checked by ear with `GridPreview` — only
while the booth is stopped, it shares the speakers), drop threshold (`overrides.fullLevel`, applied live) and
key. Overrides survive re-analysis.

Moods: `/moods` edits presets; only differences are stored (`settings.moods`). `AutoDJ` reads the mood through
`deps.resolveMood` at every decision, so edits apply from the next transition mid-set. `validateMood` guards
the editor.

Song markers: `Track.cues` (set in the track editor's *Song markers* section, with a live preview, Mark now
and nudges; hook and default start snap to the grid, dialogue is exact) — dialogue start/end, hook start/end,
default start. They survive re-analysis. `cues.ts` turns a track + a "Start from" choice into an `Entry`:
the position that lands (`land`: its drop, hook or a bar) and an optional dialogue to play first.

Landing transitions (`AutoDJ.schedule`): staff Drop, the opener's auto-drop, Desi Night songs, drop swaps and
a "Start from" of dialogue / hook / drop. With a dialogue, `dialogueIn` cuts the outgoing track (echo tail) as
the dialogue starts and the incoming deck jumps from the dialogue's end to its drop —
`Deck.start(when, offset, rate, jump)` schedules two sources with a 10 ms crossfade and `PlaybackTimeline.jump`
keeps position ↔ time right across it (plays at its own tempo, rate 1). Without one it is the drop swap.
Drop is refused while the live deck is still in its dialogue (`Deck.pendingJump`, `dropLocked`).

Desi Night (`desi` mood): `opener` — only when a set *starts* in the mood, `pickOpener` takes a slow song
(≤ `maxBpm`) from the opener crates (preferring ones with a hook), plays its hook (`openerWindow`; 32 bars from
its start if unmarked) and auto-drops into the party when the hook ends (with a riser unless a dialogue
follows). `holdForDrop` — after that, each song plays until staff press Drop; if nobody does, it mixes out by
itself near its end (`mixOutPoint` without a mood rule), so the music never stops. Booth "Up next" says
"waits for Drop". Defaults: opener crate "Romantic" ≤ 105 BPM, party crates "Bollywood party" and "Punjabi"
(empty crates fall back to the whole library). All editable on the Moods page.

Half/double tempo (`mood.halfTime`, on for Desi Night): `syncRatio(fromBpm, toBpm, halfTime)` returns the
multiplier m (1, else 2 or ½) at which the tempos are within ±8%; the incoming rate is
`outBpm / (bpm × m)`, so at m = 2 one incoming beat spans two outgoing beats (builds stay whole incoming bars).
Used in scoring, mood fit, `chooseTransition`, `isMoodJump`, the picker and `schedule`. Tempo detection folds
songs into 85–175 BPM, so a 64 BPM ballad is *detected* as 128 (already in step at 1:1); correcting it to 64 in
the editor keeps it beat-matched through half-time.

Rewind (`mood.rewind`, on for Desi Night): when two songs can't be beat-matched, `rewindInto` cuts the outgoing
fader and `Deck.rewind` plays a reversed copy of its last ~3 s after the fader, speeding up 1× → 4× and fading
over `REWIND_SECONDS` (Web Audio can't run a source backwards reliably); the next song (or its dialogue) comes in
`REWIND_LEAD` later. Replaces echo-outs in such moods.

Suggestions (analysis v4): `suggestHook` correlates per-bar harmony (mean-removed chroma) to find the 16/8-bar
stretch that repeats most (louder preferred; tried at every bar, since the grid's first downbeat often sits in
an intro) and returns its first occurrence. `suggestDialogue` finds ≥ 1.5 s of voice-band energy with no kick
or bass and syllable-rate pulsing that isn't on the beat, preferring one the beat follows within 8 s (the
< 120 Hz band jumps). Shown in the track editor with Listen / Use; never used until accepted.

Decks loaded before Play: `useSession.preloads[deck]` (`{ track, entry }`), set from the booth while stopped
(Load track / Change / Eject, Start from). Play calls `AutoDJ.start({ first, next })`: Deck A's song starts via
`firstStart()` (a dialogue start jumps to the drop; in an opener mood, Auto/Hook plays the hook and auto-drops)
and the other loaded decks become queued requests in deck order, each keeping its entry (`requestEntries`,
also restored when a re-plan puts a request back). Then the auto-DJ picks as usual.

Transition effects (`mood.autoFx`, on for Groove, Peak Hour, Desi Night): `AutoDJ.transitionFx` schedules master
effects with each planned transition — a reverb or echo throw (alternating) a beat before a blend's bass swap,
a riser over a drop's build-up (unless staff's Drop already fired one) plus `MasterFx.filterInto` closing a
low-pass over the last bar and snapping open on the drop, a reverb wash on cuts; dialogue drops and rewinds stay
clean. Re-planning a transition cancels them (`MasterFx.cancelScheduled`, eases each effect back to rest).
`snapshot().activeFx` (from `fxWindows`) lights the FX pad, with "· auto" for the auto-DJ's own.

Layer: `AutoDJ.layer(track?)` — only if `canLayer` (both grids reliable, tempos beat-matchable incl. half-time,
both keys known and ≥ `LAYER_MIN_KEY`: same, ±1 or relative). From the next 4-bar phrase `layerIn` brings the
song in beat-matched with its bass killed, rising to 85%, while the current song's mids dip 4 dB; the plan has
no end (`Planned.layer`). Drop calls `finishLayer`: `layerSwap` swaps the basslines on the next 4-bar phrase and
fades the old song over 2 bars under a rising high-pass, then the usual hand-over. A safety timer swaps by itself
before the current song's outro or 8 bars before the layered song ends, so the music never stops. The layered
song comes in on its hook (else its drop) unless staff chose beginning / drop / a bar (`layerEntry`). The booth's
Layer button layers the cued song if it matches, else opens the picker filtered to matching songs.

Audio outputs (Library → Audio outputs; `settings.mainOutput`, `settings.previewOutput`): the mix goes to the club
speakers (`AudioEngine.setOutput`, e.g. Bluetooth or the 3.5 mm jack; changeable mid-set), every preview to the
preview / cue output (`GridPreview.sinkId`, e.g. USB-C or HDMI) via `AudioContext.setSinkId` (Chrome/Edge 110+,
typed in `types/audio-sink.d.ts`). Device names need one microphone-permission grant (`unlockLabels`; nothing is
recorded). If the chosen club output disappears the mix falls back to the default output and the booth shows a
note; it returns when the device does. `previewIsSeparate()` — a preview output chosen and different from the
club one — is what allows previews and Cue during a set; otherwise they're blocked while a set plays. The booth
display waits for `engine.displayDelay` (key-lock delay + the output's `outputLatency`, large on Bluetooth).

Cue / preview: one shared player (`sharedPreview`, `store/preview.ts`) for the track editor, the booth's Cue (loaded
decks before Play, and the cued deck) and the picker's ▶ (30 s of the hook, else the drop), so only one plays at a
time. Cue plays from where the deck will start (`cuePlan`, through a dialogue's jump); "Set start here" turns the
cue playhead into a bar entry (`barAt`). Closing the picker or the editor stops its preview.

Start from: `AutoDJ.setEntry(choice)` re-plans the cued transition (like Drop and requests: only before it is
under way) and the cued deck's overview shows a ⚑ where it will start.

Silence watchdog: uses `engine.peak()` — the loudest sample over a ~0.7 s analyser window. A short RMS window
sampled every 500 ms can alias with the beat and land between sparse hits every time, reporting silence while
the music plays (seen with synthetic kick-only tracks).

## Rules for audio code

- **Schedule every sound on the AudioContext clock** (`start(when)`, `setValueAtTime`, ramps). Never trigger
  audio from `setTimeout`/`setInterval`; JS timers are only for planning and hand-over.
- **Change playback rate only via `Deck.rampRate()`** so `PlaybackTimeline` stays in sync (it also drives the
  key-lock pitch). Beat alignment depends on it. Likewise, jump inside a song only via `Deck.start(…, jump)`.
- Anything timed against what the room hears (master effects, display) adds `engine.outputDelay`.
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
- Fixed redirects (e.g. `/` → `/booth`) go in `next.config.ts` `redirects()`, not in a page that calls
  `redirect()`: such a page has nothing to render, and instant-navigation validation (cacheComponents) errors
  in dev with "Could not validate `instant`".
- State: zustand (`useLibrary`, `useSession`). UI never talks to `AudioEngine` directly.
- Styling: Tailwind CSS v4 with the dark tokens in `app/globals.css`; `.btn` and `.btn-primary` for buttons.
  The booth must stay readable on a dim screen from a distance: big targets, high contrast.
- Tune selection by changing `WEIGHTS` / thresholds in `selector.ts` and update the tests with the intent.

## Commands

```bash
npm run dev        # http://localhost:3000 (redirects to /booth)
npm run check      # typecheck + lint + unit tests — run before finishing any change
npm run build      # production build — must pass
npm run e2e        # Playwright end-to-end tests on the build (first time: npx playwright install chromium)
```

Browser testing: the Library page has an **"Add files (this session only)"** input
(`data-testid="session-files"`) that Playwright can fill without a folder picker; `e2e/fixtures.ts` generates
synthetic club tracks (intro · breakdown · drop · breakdown · drop · outro; one 6 dB quieter).
`playwright.config.ts` launches Chromium with `--autoplay-policy=no-user-gesture-required` and a silent output
device, and starts `next start -p 3100` (build first). Audio runs for real; nothing is heard.

## Known limitations / next steps

- Nothing has been checked by ear yet: drop detection, transitions, effects, key-lock and loudness matching
  are verified with unit tests and headless-browser measurements on synthetic tracks only. Do the 50-track
  listening check on the venue system before a real night.
- Key-lock is a phase vocoder: on big tempo changes it can soften transients and sound slightly "phasey".
  That's why it is off by default. Kick timing stays within 5 ms of the fixed delay (tested).
- Loudness is measured on the analysis signal, not true LUFS; fine for matching tracks to each other.
- Key detection is a single global key (no modulations); confidence below ~0.05 is a guess. Tags win.
- Drop detection uses bass level alone. Tracks whose breakdowns keep a heavy bassline need the per-track
  threshold raised in the track editor (or they mix out at the outro / `maxPlayBars`).
- The incoming track always starts at its first downbeat and plays its whole intro inside the blend
  (except drop swaps, which start a few bars before its drop).
- Session-only tracks ("Add files") vanish on reload, so queued session tracks do too.
- Grid preview shares the club speakers, so it is disabled while the booth plays (no separate cue output).
- Offline: in-app navigation waits for the network; a full reload of a visited page works.
- The set log, settings and edits live in this browser's IndexedDB only (no server, no backup) — export CSVs.
- Desi Night: the opener only happens when a set starts in Desi Night, not on a mid-set switch (by design).
  Hook / dialogue suggestions are heuristics tested on synthetic songs only: the hook can land on a repeated
  instrumental, and dialogue spoken over music (or an a-cappella line) may be missed or mistaken. Always
  listen before pressing Use.
- Rewind is an effect made from the reversed audio, not a true turntable spinback (no platter slowdown).
- Transition effects are fixed recipes on the master, so they colour both songs during a mix (e.g. the closing
  filter before a drop also darkens the incoming build-up — on purpose). Re-planning a mix also cancels an
  effect staff fired by hand moments before.
- Decks loaded before Play live in memory only (lost on reload).
- Outputs: a laptop's 3.5 mm jack and its speakers are usually one output, so the club speakers and the
  headphones must be different devices for Cue during a set. A Bluetooth drop can't be detected (the mix keeps
  "playing" inside the app), and `outputLatency` is the browser's estimate. Choosing two different outputs can't
  be tested headless (no devices); the e2e test covers the shared-output path.
- The editor preview doesn't apply key-lock or volume matching, so it can sound slightly different from the booth.
- Layer uses two decks (the playing and the cued). Layering a third song, or an a-cappella crate over the running
  mix on decks C/D, isn't built; nor is vocal separation (needs an ML model).
- Layering clashing keys is refused rather than pitch-shifted (owner decision); songs without a known key
  can't be layered.
- No server side (by owner decision for now): no accounts, sync, multi-venue, backup, remote control,
  crowd input or MIDI controllers.
- Dev tooling has known `npm audit` advisories (vitest 3, eslint-config-next); none ship in the app.
