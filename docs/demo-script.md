# Beatrice demo script — calibrate → jam → capture → arrange → export

**Phase 3 §5 exit-criteria walkthrough.** This is the end-to-end path a first-time
user takes through Jam Mode. It was walked start-to-finish against the production
build (2026-07-14, `scripts/demo-walk.mjs`) and every snag found was fixed; the
one remaining manual step (human DAW import) is called out explicitly.

Total runtime: ~90 seconds of user action.

---

## Setup

- **Native (real analysis):** `./run.sh tauri` — the captured jam is analyzed by
  the real Rust pipeline.
- **Browser demo (illustrative analysis):** `./run.sh` then open
  http://localhost:1420. Jam *detection* is the real WASM classifier; the offline
  *arrangement* is mocked (see README "Real vs. mock"). Good for showing the
  flow; not a real analysis of your beat.

Make sure system output is **unmuted** and volume is up — Jam Mode listens on the
mic and the level meter should react when you make noise.

---

## Step 1 — Calibrate (~20s, optional but recommended)

1. From the input screen, click **◉ JAM MODE**.
2. Click **● START**. Grant mic permission if prompted. The waveform starts
   moving and the level meter reacts.
3. Click **✎ TEACH** to open the calibration panel.
4. Follow the prompt for each of the 4 sounds, making each **5 times**:
   - **KICK** — a "b"/"p" lip pop
   - **HIHAT** — a "tss"/"ssh" hiss
   - **SNARE** — a "k"/"t" tongue click
   - **HUM** — a sustained "mmm"
   The progress dots fill 0→5 per class; the panel advances automatically.
5. When all 4 are taught, a **HEURISTIC / YOURS** toggle appears. Flip it to
   **YOURS** — subsequent flash tiles are now classified by *your* kNN profile,
   and you can watch a sound that the generic heuristic mislabels get the right
   color under your profile. The profile persists to localStorage (and, native,
   to the backend so the offline pipeline uses it too), so on your next jam it's
   restored automatically with a RE-TEACH option.

*Skip this step and Beatrice uses the generic heuristic classifier — jam still
works, just without per-voice tuning.*

## Step 2 — Jam (~30s)

Beatbox a groove. Every detected sound flashes as a class-colored tile the moment
the WASM detector fires, and the cumulative event counter climbs. This is the
**sketch instrument**: you *see* the band form as you jam.

> Jam Mode is **visual** — there is deliberately no live synth under your voice.
> The measured mouth-to-sound latency on built-in laptop audio is ~165ms P95,
> which would feel like an echo. See `docs/latency.md`. The flashes are instant
> because they're just visuals; the musical payoff comes at CAPTURE.

## Step 3 — Capture

Click **◉ CAPTURE**. Beatrice encodes the last few seconds of mic audio to a WAV
and hands it to the exact same pipeline an uploaded file goes through — no special
jam path. The button shows CAPTURING… then the app transitions to the results
screen.

## Step 4 — The full arrangement plays

On the results screen:
- The **▶ PLAY** button is visible — press it to hear the arrangement.
- Song Mode builds your captured beat into a 16-bar track (Intro → Build → Drop →
  Outro); the HUD shows the active section.
- The arrangement lanes show bass (walking the theme's chord progression), pads,
  arp, and drums. Click any event tile to open its decision card (why it was
  classified that way, what notes it triggered).

## Step 5 — Export MIDI

Click **📥 EXPORT MIDI**.
- **Native:** a save dialog opens; choose a location and Beatrice writes a
  standard MIDI file — bass on channel 0, pads on 1, arp on 2, drums on the GM
  percussion channel 9, with tempo, time signature, and track names embedded.
- **Browser demo:** the file downloads directly (Blob download). Note the demo's
  bytes are illustrative (mock backend); the real MIDI encoder is exercised
  natively and in the Rust golden test.

## Step 6 — Open in a DAW *(manual verification — still open)*

Import the `.mid` into Ableton / Logic / FL Studio. Each part should land on its
own track/channel with the right instrument slot, at the detected tempo.

**Automated evidence we DO have** (so this step isn't a leap of faith):
- The Rust golden test `golden_file_is_daw_correct` (`src-tauri/src/arranger/midi.rs`)
  parses the exported bytes with `midly::Smf::parse` and asserts Format 1, PPQ
  480, per-track names, and channel routing (DRUMS_KICK → ch 9, melodic lanes off
  ch 9).
- A raw byte-check of that file confirms the MIDI magic and structure:

  ```
  $ cargo test -p beatrice golden_file_is_daw_correct   # writes /tmp/beatrice-check.mid
  $ node -e '/* read /tmp/beatrice-check.mid */'
    { magic: "MThd", headerLen: 6, format: 1,
      tracksDeclared: 3, mtrkChunksFound: 3, divisionPPQ: 480, valid: true }
  ```

**What remains manual:** loading the file into an actual DAW and confirming it
sounds/routes correctly by ear. That is the one demo step not covered by an
automated gate — flagged here honestly.

---

## Walk evidence (2026-07-14, production preview)

`node scripts/demo-walk.mjs` (headless Chromium, fake mic fed
`test-audio/test-pattern.wav`) drove the whole flow:

```
WALK: entered jam screen; visual-note present: true
WALK: started jam session (mic -> worklet)
WALK: live events: count=3 flash-tiles=3          # real WASM detector fired
WALK: TEACH panel toggled; calibration-panel visible=true
WALK: CAPTURE succeeded -> reached results screen (PLAY visible)
WALK: EXPORT MIDI button present: true
WALK: MIDI downloaded: name="beatrice_BLADE RUNNER.mid" ...
WALK: console errors total: 0
```

**Snag found and fixed during the walk:** EXPORT MIDI threw
`Unknown command 'plugin:dialog|save'` in the browser demo — the MIDI handler
always used the native save dialog, while WAV export already had a Blob-download
fallback. Fixed in `src/components/ExportControls.tsx` (mirror the WAV path:
Blob download when `!isTauriAvailable()`). Re-walk: 0 console errors.
