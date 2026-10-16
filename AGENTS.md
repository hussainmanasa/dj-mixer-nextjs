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
   the picker. Cue never touches the mix. Also the **jog wheel on a loaded or cued deck** sets its start point
   (drag, scroll, keys). (Originally the deck on air stayed display-only; see the jog decision below.) From 14 Oct 2026 (owner):
   turning that jog wheel **scratches on the club speakers** (not the headphones), also over the music during a
   set, and the booth has **separate volumes for the club speakers and the headphones** (preview output).
   Also from 14 Oct 2026 (owner): **⏸ / ▶ on the on-air and cued decks** — pausing the song on air gives
   silence until ▶ (it resumes where it stopped; no automatic resume); during a mix ⏸ stops only that side and
   the other song carries on; ▶ on the cued deck brings it in on the next phrase. These go through `AutoDJ`
   like every other action (it still beat-matches and times the mix); there's still no seek, crossfader or
   per-deck fader. And (owner, 14 Oct 2026) the **jog wheel on the song on air**, playing or paused: a hand on
   it stops the song like a record and scratches it, letting go plays on from there; on a paused song it moves
   the paused spot. Not during a mix (it would throw both songs out of time).
   From 15 Oct 2026 (owner): a **tempo slider on the on-air and cued decks** (±8%, through `AutoDJ.setDeckTempo`,
   which re-times the next mix), a **spinback** (flick the on-air jog backwards fast: the song spins back and the
   cued song drops in), and the song's **cover art** on the jog wheel. Also a **Sync** button per deck (one press
   sets its BPM to the other deck's, through `setDeckTempo`) and **8 cue pads** (hot cues A–H) per deck. Jog wheels
   scratch on the club speakers whether the music plays or is paused (owner, 18 Oct 2026). And (16 Oct 2026) **beat loops**
   (¼–16 beats) on the song on air, and an **AI DJ on/off** switch: off, the auto-DJ still cues the best next song but
   doesn't mix by itself (Up next waits for Drop / ▶ Play now); if nobody mixes it comes in near the song's end and AI
   DJ switches back on, so the music never stops. (17 Oct 2026) **▶ Play now** on the cued deck while a song is on
   air plays both songs together (beat-matched) — nothing mixes out until the new song's drop or Drop. (17 Oct)
   **Saved loops** per song (track editor) and **loops on the cued deck** (armed before it plays, looping while
   playing together until Drop). **Cue in / cue out** markers (cue out: where the auto-DJ hands over), and the
   **settings file in the music folder** (settings + song edits travel with the music).
   (18 Oct 2026) **Pausing never changes the music**: ⏸ only pauses that deck (its song stays), and nothing mixes
   or swaps by itself while a deck is paused; ▶ plays at once (on the other deck's next beat); the **Layer button
   is removed** (▶ Play now + Drop do its job); every booth control is always shown, greyed out when it doesn't
   apply, so the layout never jumps. And: **two decks play independently** — ▶ Play now plays both at full level, nothing mixes or
   swaps by itself (only Drop, or a song ending); **AI DJ off** means no automatic mixing at all — songs play to their
   end and the cued one follows, and AI DJ never switches itself back on; every jog wheel turns like vinyl.
   (Owner, latest — supersedes the locks above.) **Every deck is a plain player with no conditions**: one
   **▶ Play / ⏸ Pause** toggle (no "Resume" / "Play now"), a **CDJ-style CUE**, and loops, cue pads, tempo, Sync
   and the jog wheel on any deck with a song, at any time — AI DJ on or off, also during the auto-DJ's own mix
   (it lets go and both songs play on). **AI DJ on mixes only songs nobody touched**: once staff play, pause or
   cue a song, that song plays to its end and the next one starts then. Before Play, ▶ on a loaded deck starts
   the set with that song on that deck. The headphone preview is called **🎧 Listen**.
   (Owner, latest) The booth is **laid out like a Pioneer DDJ-FLX4**: Deck A · mixer · Deck B under the "screen"
   (moods, track view, Up next, queue); loop section (IN / OUT / 4 BEAT / ½ / 2×), pad modes (HOT CUE, BEAT LOOP,
   SAVED) and round CUE / ▶ buttons on each deck; LOAD, 🎧 CUE, MASTER / PHONES knobs, AI DJ, Drop and Beat FX in the
   mixer. (Owner, latest — supersedes "no crossfader, per-deck EQ/faders" below.) **Every mixer control works**:
   TRIM, HI / MID / LOW, CFX, the channel faders and the crossfader. They act on a separate staff stage after the
   auto-DJ's automation (`Deck.setMixer`), so the auto-DJ still beat-matches and mixes underneath; a dot on each
   knob and a tick by each fader show what the auto-DJ is doing.
   Every action goes through `AutoDJ`: it still beat-matches, chooses the transition, times it on the grid
   and steers back to the mood. Do not add manual decks, crossfader, per-deck EQ/faders, skip/seek or an
   energy slider, and never let UI write to deck automation directly.
   Admin features live on `/library` and `/moods`.
3. **Mood changes only when staff pick a new one.** Never switch moods on a schedule.
   A mood change must never cut the music: re-plan only transitions that haven't started; close moods ease
   over 1–3 tracks, far tempo jumps use an echo-out (`isMoodJump`).
4. **2 decks by default, configurable 2–4** (`MIN_DECKS` / `MAX_DECKS` in `lib/types.ts`).
5. **The auto-DJ is rule-based.** An LLM (e.g. Claude) is an optional, later, off-by-default add-on. If added it
   runs only in a server route, returns schema-validated JSON, has a short timeout, falls back to the rules,
   and is never in the audio path.
6. **The music must never stop.** Keep every fail-safe working: silence watchdog, early-end recovery,
   decode-failure skip, standby deck (3+ decks), auto-resume after reload. The one exception is a staff pause
   (decision 2): the silence is deliberate, so the watchdog and early-end recovery stand down until ▶, and a
   reload while paused doesn't auto-resume. When a playing song ends with nothing else playing, the other deck's
   song starts at once (from its cue point or paused spot): only a pause stops the music.
7. **Licensing:** no AGPL/GPL dependencies (e.g. essentia.js is AGPL — don't add it). Prefer MIT/Apache/BSD.

## Architecture

```
app/
  (kiosk)/booth/page.tsx      booth screen (server page → <Booth/> client component)
  (admin)/library/page.tsx    music folder, analysis, deck count, key lock, track table + editor
  (admin)/moods/page.tsx      mood editor (presets + admin edits)
  (admin)/history/page.tsx    set log by night, CSV export
  (admin)/help/page.tsx       user guide (components/help/Guide.tsx), linked from the nav as "Help"
  manifest.ts                 PWA manifest (kiosk install)
  icon.svg · apple-icon.png · favicon.ico   tab / home-screen icon (a record in the accent colours), drawn by
                              scripts/make-icons.mjs with public/icons/* for the manifest
components/                   UI (client components)
  AppShell.tsx                service worker registration + offline banner (root layout)
  VolumeSlider.tsx            volume slider (booth and Library → Audio outputs)
  booth/                      Booth.tsx (layout: screen + controller, Drop, queue) · DeckPanel (FLX4-style deck:
                              loop section, display, jog + tempo, Transport, pad modes) · Mixer (knobs, LOAD,
                              🎧 CUE, faders, meters, crossfader) · Knob · CuePads · JogWheel · TrackOverview ·
                              FxPad · TrackPicker · frame.ts (per-frame loop)
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
    waveform.ts               PURE: 100 bins/s of peak and bass (< 200 Hz) for the track view
    key.ts                    PURE: key tag → Camelot, harmonic compatibility
    analyze.ts                client: decode at 11 025 Hz → worker
    analyze.worker.ts         Web Worker running bpm.ts and waveform.ts (one worker: see "Track view")
  dj/
    moods.ts                  PURE: mood presets + energy target curve
    selector.ts               PURE: score/rank tracks, choose transition type
    mixpoints.ts              PURE: structure-aware mix-out / cue-in points
    cues.ts                   PURE: song markers (dialogue, hook, default start), entries, opener window
    autodj.ts                 client: the orchestrator (plans, schedules, recovers)
  audio/
    timeline.ts               PURE: context time ↔ track position under rate ramps and one jump
    deck.ts                   client: source → trim → 3-band EQ → filter → fader → out [→ key-lock]
    engine.ts                 client: N decks + scratch → master → effects → limiter → analysers (meter, watchdog)
                              → master volume → out
    scratch.ts                client: jog-wheel scratch on the engine (loads public/worklets/scrub.js)
    volume.ts                 PURE: volume slider → gain (club speakers and headphones)
    transitions.ts            client: blend, filterSweep, echoOut, cut, dropIn, dialogueIn automation
    fx.ts                     client: staff effects on the master (echo, filter, reverb, noise riser)
    keylock.ts                client: loads public/worklets/keylock.js (phase-vocoder pitch corrector)
    outputs.ts                client: list output devices, route an AudioContext (setSinkId), test tone
  library/
    scan.ts                   client: folder walk, content hash ids, tag reading
    store.ts                  client: IndexedDB persistence (idb-keyval): tracks, settings, session, set log
    setlog.ts · issues.ts     PURE: nights + CSV for licence reports; library health checks
    folders.ts                PURE: the music folder as a tree (subfolders, songs, ready / analysing counts)
    preview.ts                client: the shared preview player (editor, booth Cue, picker) on the preview output
    waveform.ts               client: a song's detailed waveform for the track view, cached in IndexedDB (`wave:<id>`)
    artwork.ts                client: cover art from tags → 320 px WebP thumbnail, cached in IndexedDB (`art:<id>`)
store/
  library.ts                  zustand: tracks, folder, settings, analysis queue
  session.ts                  zustand: owns the single AutoDJ, mirrors its status
  preview.ts                  zustand: the shared preview player (one preview at a time)
types/fs-access.d.ts          File System Access API typings
public/sw.js                  service worker (offline app shell)
public/worklets/keylock.js    key-lock AudioWorklet (plain JS; DSP unit-tested in lib/audio/keylock.test.ts)
public/worklets/scrub.js      jog-wheel scratch AudioWorklet (plain JS; unit-tested in lib/audio/scrub.test.ts)
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

Staff mixer (`lib/audio/mixer.ts` PURE + tested; `Deck.setMixer`, `AudioEngine.setMixer / setCrossfader`,
`AutoDJ.setMixer / setCrossfader`, `useSession.mixer / crossfader / setMixer / setCrossfader`): each deck runs
source → trim → EQ → filter → fader (the auto-DJ's automation, untouched) → **staff stage** (TRIM ±12 dB → lowshelf /
peaking / highshelf EQ, −26 dB kill … +6 dB → CFX biquad: low-pass 20 kHz → 150 Hz to the left, high-pass 20 Hz →
6 kHz to the right, open in the centre → channel fader (squared taper) × crossfader) → out. The echo send feeds the
staff stage too. Values glide over ~15 ms (`setTargetAtTime`). The crossfader is a "sharp" curve: centre = both
full, each end cuts the other side; decks C / D aren't on it. Settings belong to the channel (they stay when a new
song loads), live in the session store (set before Play too; applied in `ensureDj`) and reset on reload. The
silence watchdog stands down while the song on air's staff gain (`engine.channelGain`) is below `STAFF_MUTED`
(staff turned it down on purpose); the mixer then says "Deck A turned down — the club doesn't hear it". The level
meters tap after the staff stage. UI: `Knob` (drag up / down, scroll, keys, double-click to centre, a range input
under the face) and `Fader` (drag or click the track, keys, double-click to reset), both with an `auto` indicator.

Booth layout (DDJ-FLX4): `Booth` renders the "screen" (mood buttons, `TrackStack`, a fixed-height notes line) above
the controller grid `[Deck A][Mixer 22rem][Deck B]` (stacked below `lg`; decks C / D in a row below,
each with its own `LoadButton` / `ListenButtons` in the deck's `strip`). `DeckPanel`: `LoopSection` (IN / OUT set a
loop by hand through `savedLoop`, 4 BEAT / EXIT, ½ / 2× resize the loop via `loop(beats)` or `savedLoop`), BEAT SYNC,
the display (badge, ⏏, song, BPM, time, `TrackOverview`, Start from), the jog with the tempo slider, `Transport` (round
CUE / ▶ ⏸) and `PadSection` (modes HOT CUE → `CuePads`, BEAT LOOP → ¼…32 beats, SAVED → saved loops; Clear in the mode
row). `Mixer`: `VolumeKnob`s (a range input under a rotary face, so keys / `fill` work) for MASTER / PHONES around
`PlayStopButton`, the master `LevelMeter`, `LoadButton`s (aria "Load track, Deck A" …), `ChannelKnobs` (display
the auto-DJ's dots via `setKnob` from `DeckView.trimDb / highDb / midDb / bassDb / cfx`), AI DJ / Drop / `FxPad` down the middle,
`ListenButtons` (aria "Listen, Deck A", "Set start here, Deck A"), and `Faders` (staff channel faders and crossfader,
the auto-DJ's fade as a tick from `DeckView.fader`, meters from `DeckView.level` = `Deck.level()`, an analyser after
the staff stage). `e2e/controller.spec.ts` checks the layout, the loop section and that every mixer control changes
the sound.

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
`rankForRequest()` (same score as the auto-DJ, recently played last, off-tempo flagged). While the picker is open the page
behind it doesn't scroll (`overflow: hidden` on `<html>`, the scrollbar's width kept as padding; the list is
`overscroll-contain`; `e2e/picker-scroll.spec.ts`).

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
worklet can't load. Switches live, also mid-set (see "Live settings"). The booth shows a **KEY LOCK** badge on each deck only when
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

Cue in / cue out: `TrackCues.start` (shown as "Cue in"; Start from: Auto starts there) and `TrackCues.end` ("Cue out").
`mixOutFor(a, cueOut, …)` (mixpoints.ts, PURE, tested) starts the transition `leadBars` before the cue out so its
hand-over lands there, when it is still ahead; otherwise `mixOutPoint`. `schedule` uses it for blends, landing entries
(drop swaps, Desi Night / AI DJ-off holds) and the layer safety swap; the track view's MIX marker follows.

Settings file (`lib/library/settingsFile.ts` PURE + tested, `settingsFolder.ts` client): `ai-dj-mixer-settings.json`
in the music folder's root — portable settings (deck count, key lock, mood edits, volumes; never device ids) and each
edited song's `editsOf` (flag, crates, cues, hot cues, saved loops, overrides) keyed by content id with path / title.
`useLibrary.syncSettingsFile()` runs on hydrate (folder ready), after a reconnect and after every scan (before
analysis, so a fixed grid is analysed fixed): it reads our file, else any root `.json` that parses as ours, and
imports it when its `savedAt` is newer than this computer's last sync (`settingsFile:syncedAt` in IndexedDB) —
settings merged, edits applied by id else path (`applySettingsFile`; grid fixes re-analyse, key / drop fixes
re-apply). Writing needs `readwrite` permission: `enableSettingsFile()` asks (a click), after which a subscription
rewrites the file 1 s after any change to settings or edits (skipped when `contentKey` is unchanged) — never before
the folder's own file has been read (`synced`), so a fresh computer can't overwrite it. `settingsFile` state drives
the note on the Library page. The file wins when it is newer: unsaved local edits made without write permission can
be replaced by a newer file.

Song markers on the waveform (`components/library/MarkerWaveform.tsx`, top of the track editor's Song markers):
an overview of the whole song (click / drag to look there, double-click to listen) and a zoomed view (2–32 s,
beats and numbered bars) drawn every frame from the cached waveform (`waveformFor`) — drops, the dialogue and hook
ranges, the default start, the yellow cursor and the preview playhead (followed while listening, until you scroll).
Dragging a handle moves a marker (saved on release; hook and default start `snapToBar`, the dialogue exact to 1 ms);
dragging the waveform or a trackpad swipe scrolls; Ctrl + wheel / pinch zooms; a click sets the cursor and plays from
there; "Set here" buttons put any marker at the cursor.

Library track table: **Folders** view (default) mirrors the music folder (`folderTree` from `Track.path`): folder
rows open and close, each with its song count and — while analysing — how many are left and a progress bar (counts
include subfolders). Folders start closed except "Added this session" (session-only files); a search, filter or crate
opens every folder with a match; Expand all / Collapse all; **List** view is the old flat list. Analysis runs folder
by folder (pending tracks sorted by path).

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

Layer machinery (no button since 18 Oct 2026; ▶ Play now uses it): `scheduleLayer` brings a song in beat-matched
with its bass killed (`layerIn`: rising to 85%, the current song's mids dip 4 dB); the plan has no end
(`Planned.layer`). `finishLayer` (Drop, the drop swap or the safety swap): `layerSwap` swaps the basslines on the
next 4-bar phrase (or at `at`) and fades the old song over 2 bars under a rising high-pass, then the usual hand-over;
with `incFull` (the song playing along already at full level) only the old song's bass goes and it fades.
`canLayer` / `LAYER_MIN_KEY` remain in the selector (the picker's `layerable` flag), unused by the booth.

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
cue playhead into a bar entry (`barAt`). Closing the picker or the editor stops its preview. A deck's cue also
stops when its mix is about to start, when its song or role changes, and when the set starts (`useSession.play`).

Jog wheel (`JogWheel` with `scrub`, loaded and cued decks until their mix begins): drag round (like vinyl on every
deck since 18 Oct 2026 — one turn ≈ 1.8 s of audio, Shift a quarter of that — so every deck scratches the same), scroll (1 beat a notch) or keys (←/→ beat, Shift bar, PageUp/PageDown 8 bars, Home). It shows
the start point (platter angle, "Bar 11.2", the overview's ⚑ moves live) and saves it on release / after a
pause as a beat-snapped fractional bar entry (`beatBar`; `{ kind: "bar", bar: 10.25 }` = bar 11, beat 2) through
the same `setEntry` / `setPreloadEntry` as Start from.

Scratch (owner decision: on the club speakers): turning the wheel plays the song like a record under a hand,
on the mix's engine — `useSession.scratch` → `AutoDJ.scratch(track, position, step)` → `engine.scratch`
(`Scratch`, `lib/audio/scratch.ts`) into the master, so it goes through the effects, limiter and master volume.
It hands the ±20 s around the position to the `scrub` worklet (`public/worklets/scrub.js`), which chases the
wheel (forwards, backwards, up to 6× speed, silent when the wheel stops, louder the faster it turns). A drag
sends `target`; a key / scroll step sends `play` (a 0.25 s blip from the new beat); release sends `end`. It is
sound only — it never moves a deck or its automation. Before Play the engine is created on the first scratch
(`ensureDj` in `store/session.ts`, also used by Play) and the loaded song is decoded once; if it is Deck A's song,
Play reuses that buffer. During a set the cued deck's own buffer is used (silent until it's decoded — no extra
copy in memory), so a scratch plays over the music on the same speakers. A playing cue (headphones) pauses
while scratching and resumes from the new start on release; the scratch ends if the deck's mix starts mid-drag.

Volumes (owner decision: one for each output): two sliders on the booth (under the level meter) and the same two
under each output in Library → Audio outputs (`VolumeSlider`), both saved and both a squared taper (`volumeGain`:
50% ≈ −12 dB, never a boost) gliding 30 ms so a slider never clicks.
- **Club speakers** (`settings.volume`, `useSession.setVolume`): `engine.volume` is the last gain before the
  speakers, **after** the meter and the watchdog's analyser, so turning it down (even to 0) never reads as silence
  and never triggers a recovery; the booth warns "Volume is at 0" while a set plays. Covers the mix and the jog
  scratch. Set before Play, it applies when the engine is created.
- **Headphones** (`settings.previewVolume`, `useLibrary.setPreviewVolume`): `GridPreview`'s own output gain, which
  every preview sound goes through (Cue, picker ▶, the track editor and its grid clicks); applied on hydrate.
- Each output's **Test sound** plays at that output's volume.

Deck controls (`AutoDJ.pauseDeck` / `playDeck` / `cue` / `loop` / `jumpTo` / `setDeckTempo`, `useSession`;
`Transport` (CUE + one ▶ / ⏸ button) in `DeckPanel`). Rules: **nothing is locked** — every control works on any
deck with a song, at any time; **pausing never changes the music**; **the auto-DJ only mixes songs nobody touched**.
- Roles: `current` (the song on air) and `planned` (the next song). `isCued(p)`: loaded, not playing (held, or its
  mix still to come). `isPair(p)`: two songs side by side (a started `layer` plan without a swap under way).
- `letGo()`: ▶, ⏸, CUE or a hand on a wheel during the auto-DJ's own mix ends its automation — `toPair` (both at
  full, effects and tempo glide cancelled, `touched`), or, when the outgoing fader is already ~0 (a cut, an
  echo-out), an immediate `handover`. Loops, cue pads and tempo during a mix just apply to that deck; the mix
  carries on. `Deck.cancelJump()` (called by `jumpAt` / `setLoop`) lets a pending dialogue jump go, so loops and
  pads work during a dialogue too (the song then plays straight on).
- `touched` (`current.touched`, `Planned.touched`): set by ⏸ / ▶ / CUE / a wheel hold on the song on air, by ▶ or
  CUE on the cued song, and for every pair. `schedule()` plans a **manual** transition when AI DJ is off or either
  song is touched (`manual`: a `cut` at the very end of the song on air; Up next "After this song"); Drop
  (`staffDrop`) still mixes. `unplan()` returns `touched`, `reschedule()` keeps it.
- ⏸ on air with nothing else sounding: the deck fades out in `PAUSE_FADE` (60 ms) and stops; `paused` keeps its
  position, tempo and a pending dialogue jump (`pauseStateOf`). The cued transition is **held** (`holdPlanned`), and
  `planNext` holds instead of scheduling. Watchdog and early-end recovery are off, effects refuse, the standby is
  dropped; `status.silent` drives the floating Paused banner. Saved as not playing, so a reload stays silent.
- Pair: ⏸ on either deck pauses only it (`paused` / `pausedAlong`, each with `hold` for a hand on the wheel —
  `status.holding` is that deck's index). Nothing in a pair mixes or swaps by itself: `rearmPair` only times each
  playing (unpaused, unlooped) song's end, and `songEnded` applies the never-stop rule — the song on air ending
  hands over to the one playing along (`handover`; if that one was stopped, it starts at once); the one playing
  along ending frees its deck (a new song is cued) and, if the song on air was paused, that one starts again. Only
  Drop mixes (`finishLayer`, `layerSwap(…, incFull)`).
- ▶ (`playDeck`): a stopped song plays from where it stands — `resumeSynced` (on the partner's next beat,
  tempo-matched, same beat of the bar) when the other deck plays, else `startNow` (at once, own tempo; also when a
  wheel lets go). The song on air then re-plans the held next song (`afterLiveResume`). ▶ on the cued song:
  `scheduleLayer` (together at full, beat-matched when possible; `alone` if the song on air is paused).
- CUE (`AutoDJ.cue(i, down)`, CDJ): cue points live in `cuePoints` per deck (keyed by track id); the default is
  where the song started (`current.from`) or, for the cued song, its start point (`startOf`). Down on a playing deck:
  pause + `movePaused` to the cue point. Down on a stopped deck away from it (> `CUE_SNAP`): that spot becomes the cue
  point, silently. Down at the cue point: `startNow` from it and `cueHeld`; up: back there, stopped (`cueUp`).
  ▶ while held (`keepCue`) keeps it playing — the booth's ▶ acts on pointer-down while CUE is held, before CUE
  loses focus. On the cued song, down plays it at once (`scheduleLayer(…, { alone, quiet })`); up takes it back and
  re-plans it as cued and `touched` (it starts when the song on air ends). `status.cuePoints` feeds the overview ⚑.
- Loops on a stopped song (paused or cued) are **armed** (`armed`, a map by track id): `applyArmed` starts them when
  the song plays (`startNow`, `resumeSynced`, `scheduleLayer`; `intoArmed` moves the start inside the loop). A loop
  on the song on air holds a cued mix that hasn't started; one under way carries on.
- Before the set, ▶ on a loaded deck calls `useSession.play(deck)` → `start({ first, firstDeck, next })`: that song
  plays first on that deck, the other loaded decks follow in deck order.
- The booth's controls are all always rendered (transport, tempo / Sync, Change / Eject, Start from with all five
  choices, 🎧 Listen, loops with four saved-loop slots, cue pads, the AI DJ switch, Up next, the bar counter, a row
  per deck in the track view, reserved space for notes and warnings); only a deck without a song greys them out, so
  nothing moves (`e2e/stable-layout.spec.ts` measures it). `e2e/cdj-cue.spec.ts` covers CUE, the toggle, controls
  during a mix and ▶ before the set.

Tempo sliders (`DeckPanel`, beside the jog wheel of the on-air and cued decks during a set; ±`MAX_TEMPO` = 8%,
double-click or the % button resets; BPM and "tempo ±x%" now sit under the title, the jog centre shows cover art):
`AutoDJ.setDeckTempo(i, rate)`.
- On air: `Deck.changeRate(rate)` glides there over 0.15 s — it cancels any glide still scheduled
  (`cancelAndHoldAtTime`) and rebases the timeline first (`rebaseTimeline`, PURE, tested: a timeline holds one
  ramp). The cued mix is re-planned 300 ms after the slider rests (`replanSoon`) so it stays on the new grid.
  Paused: `paused.rate`, used on ▶ (a pause also keeps the tempo it was at, or heading for mid-glide).
- Cued: `Planned.tempo`, the rate it settles at after its mix — the hand-back glide aims there instead of 1, and
  unsynced entries (cut, echo-out, rewind) start at it. Kept through every re-plan (`unplan` returns it).
- During a mix under way the deck goes to the new tempo at once (`changeRate`; the hand-back glide is replaced).
The slider shows the live rate every frame (the auto-DJ's sync and glides move it), the cued song's target before
its mix.

Track view (`components/booth/TrackStack.tsx`, above the decks): one row per deck song — loaded decks before Play,
the on-air and cued decks during the set — with details, a canvas waveform drawn every frame and a beat block
(beat dots, bar.beat, phrase, mix / start / drop countdowns). The waveform (`lib/analysis/waveform.ts`: per 10 ms,
the loudest sample and the loudest bass, scaled to the track's 99th-percentile peak) is built the first time a song
is shown — decoded at 11 kHz and computed in the analysis worker (`waveformOf` in analyze.ts) — and cached as
`wave:<id>` (~30 KB); until then the row draws `barLevels`. Each row maps room time to track time through its
deck's rate (`x = (t − pos) / rate`), so beat-matched decks share one beat spacing; a cued deck's position before
its start is extrapolated from `DeckView.startsAt`, so it scrolls in. Drawn on top: drops (shaded), beats / bars
(numbered) / 8-bar phrases (mood colour), cue pads, the live deck's mix-out (`snapshot.mixOutPosition`, "MIX") and
the cued / loaded start ("IN"). Zoom: 4–32 s across. Workers: a second `new Worker(new URL(…))` was handed the
analysis worker's entry by the production bundler, so all CPU work shares `analyze.worker.ts` (messages carry
`kind`).

Loops are per deck (`AutoDJ.loops`: Map<Deck, …>) plus one `armed` loop for the cued song. `loop(i, beats)` and
`savedLoop(i, start, end)` go through `loopAt` on whichever song is on that deck (`songOn`): the song on air (not
paused / in a dialogue / during a mix — a layer or playing together before its swap is fine), the song playing along
(started layer, before its swap), or the cued song before it plays — then the loop is armed (`armed`, and its Start
from becomes the loop's start as a bar entry) and `scheduleLayer(…, { together })` engages it when ▶ Play now starts
the song (`Deck.setLoop` on a source not yet started sets the loop without rebasing). A song playing along that loops
has its drop swap cancelled (`swapAt` cleared; `armSafetySwap` keeps the swap before the song on air runs out);
exiting re-arms the swap at its next drop (`armDropSwap`). Drop, a mix, Layer and the safety swap let loops go
(`endLoops` / `endLoopOn`); takeOver, cancelMix and handover forget the decks that went. A loop past the playhead
(saved loops) jumps there on the next beat first (`jumpAt`). An armed loop is dropped if the auto-DJ mixes the song in
by itself. Saved loops: `Track.savedLoops` (≤ `MAX_SAVED_LOOPS` = 4, `useLibrary.setSavedLoops`), made / dragged /
listened / deleted on the track editor's waveform (`MarkerWaveform`: start on a bar, edges on the beat grid), shown
as deck buttons, outlined in the track view (loops playing shaded, armed ones with dashed edges). `status.loops` /
`snapshot.loops` list them.

Loops (`AutoDJ.loop(i, beats)` / `exitLoop`, `LoopButtons` in `DeckPanel`): `Deck.setLoop(start, end)` sets
`AudioBufferSourceNode.loop` / `loopStart` / `loopEnd` (the playhead plays on to `end`, then wraps) and the timeline's
`loop` (`positionAt` wraps the same way; `rebaseTimeline` keeps it; `timeAt` ignores it — nothing is scheduled inside
a loop). The loop starts on the beat the playhead is in (a short loop: the first loop-length step still ahead) and a
second press resizes it from the same start. The cued mix is held while looping (`holdPlanned`, `planNext` holds
too) and re-planned on exit. Drop, ▶ Play now and Layer end the loop first (`endLoop`), a cue pad exits it, a pause
or a hand on the wheel lets it go. Refused during or just before a mix, while paused and in a dialogue.
`status.loop` / `snapshot.loop` drive the lit button, "After the loop" and the shaded region in the track view.

Playing together (▶ Play now while a song is on air): `playDeck` calls `scheduleLayer(…, { together })` when the
tempos can be beat-matched (`syncRatio`, both grids ≥ `MIN_BLEND_CONFIDENCE`) and the song isn't set to start from its
drop. It starts **at once** at full level (both decks full — no bass kill, no dip): on the song on air's next beat,
from its own start point (Auto = cue in, else its Start from) moved on to the same beat of the bar, when the two can
be beat-matched; otherwise right away at its own tempo. Any key, any tempo. (Earlier the swap was armed at its first
drop after that
(`layer.swapAt`, `finishLayer(at)` → `layerSwap` exactly there), else the usual safety before either song runs out.
Drop swaps earlier (`finishLayer()`). After the swap the new song glides to its own (or staff's) tempo.
`UpNext.together` drives "Playing together", "together · mixes at its drop in …" and the "Playing along" badges.

AI DJ mode (`AutoDJ.setAuto(on)`, the "AI DJ" switch under Play / Stop): off, `schedule` plans no mix at all
(`manual`): the cued song starts the moment the song on air ends (`cut` at its last 50 ms, `firstStart`), nothing
overlaps, no Drop countdown (`UpNext.afterSong`: "After this song"; no MIX marker, `mixOutPosition` null), and the
song's ending isn't treated as "ended early". Staff Drop / ▶ Play now still mix by hand. AI DJ never switches itself
back on. Toggling re-plans a cued mix that hasn't started. Not saved: a reload starts with AI DJ on.

Sync (`AutoDJ.syncDeck(i)`, button under each tempo slider): the song on air takes the cued song's tempo after its
mix (`b.bpm × Planned.tempo`), the cued song takes the song on air's current BPM; `syncRatio(…, true)` allows half
/ double tempo and refuses beyond ±8%. One-shot (not a lock); the button lights while the BPMs match (frame loop).

Cue pads (`components/booth/CuePads.tsx`, on loaded, cued and on-air decks): `Track.hotCues` (8 slots, track
seconds snapped to a beat; `useLibrary.setHotCue`, persisted and synced like any track edit; `DeckPanel` reads the
library's copy of the track since the deck's copy is a snapshot). An empty pad saves the deck's spot (on air: the
snapshot position; paused: the paused spot; loaded / cued: the cue playhead if cueing, else the start point). A set
pad: on air `AutoDJ.jumpTo(i, to)` → `Deck.jumpAt(at, to)` on the next beat — a second source with a 10 ms
crossfade on the audio clock, tempo held (a glide under way carries on after), the timeline rebased with the jump —
then the cued mix is re-planned; paused, `movePaused`; loaded / cued, a bar entry. Refused during the mix (or
within `SCHEDULE_MARGIN` + 1 s of it) and while a dialogue's jump is still to come. The overview marks set pads.
Every source now plays through its own gain (`Deck.sourceGain`) so it can be faded at a jump.

Jog gestures (`JogWheel`): every input turns the platter through one `turn(deg)` — one pointer (mouse / finger:
angle round the centre), two pointers (touchscreen twist: the angle of the line between them; dropping to one finger
carries on without a jump), a trackpad two-finger swipe (`wheel` with pixel deltas: 600 px = one turn, larger axis,
positive = forwards; the swipe ends 160 ms after the last event, so momentum scrolling keeps the record turning; a
pinch, `ctrlKey`, is ignored), while a mouse wheel notch (`deltaMode` ≠ 0 or a whole ±100+ delta) steps one beat.
Spinback: turning backwards faster than 1080°/s (over the last 120 ms) calls `live.onFling` instead of `onCommit` —
on release for pointers, at once during a swipe (the rest of that swipe is then ignored). `AutoDJ.spinBack()` plays `Deck.rewind` from the
held position (`from` param, the deck is already stopped) and starts the cued song `REWIND_LEAD` later on its
landing entry (`resolveEntry`: its drop, through its dialogue if marked; its staff tempo). The old deck is freed and
the next song planned once the spinback has played out. Without a cued song it just plays on (`releaseDeck`).
Tests must flick in small steps: Chrome merges pointer moves sent back to back, and a merged jump of over half a
turn reads as the other direction.

Cover art (`lib/library/artwork.ts`, `components/booth/useArtwork.ts`): read lazily from the file the first time a
deck shows the song (`music-metadata` pictures, front cover first), centre-cropped to a 320 px WebP and stored as
`art:<id>` in IndexedDB (`false` when it has none, so tags are read once per song). It sits on the record's label
and turns with the platter; without art the label shows the title's initials in the mood colour.

Jog wheel on air (`JogScrub.live`, the on-air deck playing or paused, never while its mix sounds): it turns like
vinyl, 200° per second of audio (Shift a quarter of that), starting from where the song is. Touching it
(`useSession.grabDeck`) is `AutoDJ.pauseDeck(i, hold)` with a 12 ms fade (`paused.hold`, `status.holding`: badge
"Scratch", no Paused banner); turning plays the scratch (`engine.scratch` on the club speakers) and letting go
(`releaseDeck`) calls `movePaused(position)` then `playDeck(i, 0.012)`, so the held mix is re-planned from the new
spot. On a song staff paused, the wheel only moves the paused spot (`movePaused`) and ▶ plays from there. A
dialogue's jump to the drop survives a move that stays before the dialogue's end; letting go within 2 s of the end
hands over to `recover` like an ending song. Keys and scroll step a beat the same way (grab, blip, release after
350 ms).

Live settings: every setting applies as soon as it changes, with no reload and no Stop. `store/session.ts`
subscribes to `useLibrary` and `applySettings` passes changes to the running AutoDJ: club volume and output at
once; key-lock via `AutoDJ.setKeyLock` → `engine.setKeyLock(on, fade)`, where each deck crossfades from its old
route to the new one over 40 ms (`Deck.setKeyLock(node, fade)`; the new node's pitch picks up the deck's rate and
any glide under way; `outputDelay` changes at once, so effects already scheduled are off by the key-lock delay);
deck count via `AutoDJ.setDeckCount` — `engine.addDecks` at once (a 3rd deck takes a standby), and extra decks are
removed from the end as soon as nothing plays, waits or is paused on them (`trimDecks`, checked on every status
change; `freeDeck(…, deckTarget)` never picks a deck that's going). Preview output and volume apply on the next
sound; moods at the next decision; track edits from the next pick. Across tabs: `store/library.ts` posts
"settings" / "tracks" on a `BroadcastChannel` after every save, and other tabs reload them from IndexedDB (keeping
their own session-only files), so the booth follows a Library page open in another tab.

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
- Settings apply live (see "Live settings"): never make a setting wait for Play or a reload.
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
- The in-app guide (`components/help/Guide.tsx`, `/help`) is for staff and the venue admin: when you add or change
  something they see or do, update its section there (plain words, the labels as they appear on screen) as well as
  the README.

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
- Previews (grid, Cue, picker) are disabled while the booth plays unless a separate preview output
  is chosen (Library → Audio outputs).
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
- The jog scratch is a simple varispeed: no vinyl noise, no key-lock, no volume matching, and the wheel's momentum
  stops when you let go (no spin-out). During a set it plays the cued song over the music (owner's choice);
  key / scroll steps blip there too. Only tested headless (the output is measured, not heard).
- The tempo slider isn't on decks loaded before Play (they start at their own tempo), and a cued song with a
  dialogue plays its dialogue at its own tempo. Moving the on-air tempo far from the cued song's can turn a planned
  blend into an echo-out or cut (beyond ±8% sync).
- The track view's waveform shows bass vs the rest, not rekordbox-style three-band colour, and is built at 11 kHz
  (no detail above ~5 kHz). A song's first appearance shows bar blocks for a moment while it is prepared.
- While a loop plays, the track view still draws the song ahead as it would play without the loop. Loops end at
  the song's end at the latest; a tempo glide under way freezes at its current rate while looping.
- Two songs playing together are both at full level; there's no control over either's level while both play.
  Two songs in clashing keys can sound rough together (▶ doesn't refuse them).
- Cue pads only jump the song on air between beats of its own grid, so a wrong beat grid makes the jump land off
  the beat (fix the grid in the track editor). A pad saved on a session-only file is lost with the file.
- Spinback is a fixed recipe (0.9 s, reversed audio speeding up), not a physical spin-down; it needs a cued song.
- Cover art is read from tags only (no online lookup); WAVs rarely carry it.
- Scratching the song on air uses the scratch worklet (no key-lock, no volume matching), so it can sound a little
  louder or quieter than the song; the song restarts at its own tempo when let go, so the next mix is re-planned.
- Switching key-lock mid-set smears for ~40 ms (the key-locked route is ~45 ms later). Track edits in another
  tab reach the booth, but a song already on a deck keeps the analysis it was loaded with until it plays again.
- Deck pause/play is a short fade-out / fade-in, not a vinyl-style stop. Pressing ▶, ⏸, CUE or a wheel during the
  auto-DJ's own mix ends that mix's automation: both songs jump to full level (staff then mix with Drop). Loops,
  pads or tempo during a mix leave its automation running, so a song can loop or drift while it fades out.
- CUE: holding it on the cued song plays it at once at its own tempo, not beat-matched (like a CDJ); ▶ while
  holding needs a second finger on a touchscreen, or Space on the focused CUE button plus a mouse click on ▶.
  CUE before the set is disabled (🎧 Listen previews instead). Cue points live in memory only (not saved with
  the song; the cue pads are).
- The auto-DJ's "touched" rule is per song: after staff play, pause or cue a song it never mixes out of it, so
  that song always plays to its very end (no early mix-out at a breakdown).
- The level meter shows the mix before the club speakers' volume, so it still moves with the volume at 0.
- With no separate preview output, previews and the mix share one device, so the two volumes set two sounds on the
  same speakers (the headphones slider then only changes previews).
- The editor preview doesn't apply key-lock or volume matching, so it can sound slightly different from the booth.
- The bar counter, Up next card and request Queue were removed (owner: of no use). The track view shows bars, phrases
  and countdowns; the cued row's `nextHow()` line (`data-testid="up-next"`) says how the next song comes in. With no
  Queue there's no "Add track": staff choose the next song with LOAD (or load decks before Play); the request queue
  still exists inside the AutoDJ (loaded decks after Deck A go there, and it is still saved for auto-resume).
- The FLX4 layout has no SHIFT layer and no PAD FX / BEAT JUMP / SAMPLER pad modes. A real DDJ-FLX4 over MIDI isn't
  supported (no MIDI, by owner decision). IN / OUT loops snap to the nearest beat.
- The staff mixer adds to the auto-DJ's mix rather than replacing it: e.g. the auto-DJ still fades a song out even if
  its channel fader is up, and a crossfader left at one end cuts the other deck when the auto-DJ mixes into it (the
  booth warns, and the watchdog doesn't treat it as a failure). Decks C / D have no knobs or faders (the mixer has
  two channels). Mixer settings aren't saved across a reload. The CFX switches filter type at the centre (both wide
  open there, so it's inaudible).
- Two songs play together on two decks (the playing and the cued); a third song over them, or an a-cappella crate on
  decks C/D, isn't built; nor is vocal separation (needs an ML model). Clashing keys aren't pitch-shifted.
- ▶ starts on the next beat (not the next phrase), matched to the bar; a song resumed into a pair starts from its own
  next beat moved to the partner's beat of the bar, so up to 3 beats of it are skipped.
- No server side (by owner decision for now): no accounts, sync, multi-venue, backup, remote control,
  crowd input or MIDI controllers.
- Dev tooling has known `npm audit` advisories (vitest 3, eslint-config-next); none ship in the app.
