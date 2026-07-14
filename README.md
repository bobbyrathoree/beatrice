# Beatrice

> Beatbox into your mic. Get a synth beat out.

Beatrice is a desktop app that transforms beatbox performances into harmonically intelligent synthesizer arrangements. You provide the rhythm with your mouth — kicks, hi-hats, snares, and hums — and Beatrice detects each sound, classifies it, estimates your tempo, and arranges everything into a multi-track composition that follows real chord progressions.

<p align="center">
  <img src="docs/logo.png" alt="Beatrice Logo" width="300">
</p>

## How It Works

1. **Record or upload** a beatbox performance (WAV)
2. **Beatrice listens** — onset detection finds every sound, classification identifies what each one is
3. **Tempo is estimated** from your natural rhythm
4. **Events are quantized** to a musical grid with swing and feel controls
5. **A harmonic arrangement is generated** — bass walks chord progressions, pads play triads, arps follow your rhythm
6. **Song Mode** turns your 4-bar loop into a 16-bar evolving track with intro, build, drop, and outro
7. **Export as MIDI** (bass, pads, arp, and drums each on their own channel) or **export WAV** — both rendered from the same WebAudio engine you hear in-app

## Screenshots

### Home Screen
![Home](docs/screenshots/01-home.png)
Record live, upload a WAV file, or try the built-in demo.

### Results — Waveform & Playback
![Results](docs/screenshots/02-results.png)
Color-coded waveform visualization, B-sound markers, Song Mode HUD showing the active section (Intro/Build/Drop/Outro), and playback controls.

### Song Arrangement (16 Bars)
![Arrangement](docs/screenshots/03-arrangement.png)
Visual arrangement showing all instrument lanes across 4 Song Mode phases. The harmonic engine walks the bass through the theme's chord progression (Dm → Bb → F → C for Blade Runner).

### Groove Controls
![Controls](docs/screenshots/04-controls.png)
Tempo (auto-detected), time signature, grid division, feel (straight/swing/halftime), quantize strength, and the B-Emphasis slider that controls how strongly your kick sounds drive the bass synth.

### Export
![Export](docs/screenshots/05-export.png)
Export MIDI for any DAW (Ableton, Logic, FL Studio) or export a WAV. The MIDI file routes each part to its own channel — bass on channel 0, pads on 1, arp on 2, and drums on the GM percussion channel 9 — so it loads cleanly with the right instruments. WAV export is rendered from the same in-app WebAudio engine (via an `OfflineAudioContext`), so the file matches the preview exactly.

### Explainability — Event Decision Card
![Decision Card](docs/screenshots/06-decision-card.png)
Click any detected event to see exactly why Beatrice classified it that way — timing adjustment, confidence level, which instruments were triggered, and the actual musical notes assigned (e.g., BASS → D2).

## Sound Classification

Beatrice recognizes 4 types of beatbox sounds:

| Your Sound | Class | Triggers | What It Detects |
|-----------|-------|----------|---------|
| "B" or "P" (lip pop) | BilabialPlosive | Kick drum + Bass synth | Low frequency burst, strong low-band energy |
| "TS" or "SSH" (teeth hiss) | HihatNoise | Hi-hat | High frequency noise, high ZCR |
| "T" or "K" (tongue click) | Click | Snare drum | Mid-frequency transient, sharp crest factor |
| Humming / "mmm" | HumVoiced | Pad chord (triad) | Sustained tone, low crest factor |

### Real-World Accuracy

Beatrice's classifier is measured two ways: a small in-house demo sanity check,
and a reproducible run against the published AVP benchmark (see
[Benchmark](#benchmark) for the honest, apples-to-apples numbers).

> **Demo note (n = 3, not a benchmark).** On 3 hand-recorded clips (laptop mic,
> one untrained user) the pipeline hit 93.8% detection (43 events), classified
> every detected event in line with user intent, produced 0 confirmed false
> positives, and estimated tempo within 2% — with BilabialPlosive/HumVoiced the
> strongest classes and HihatNoise the weakest (sibilants are quiet on laptop
> mics). This is an anecdote from one mic, not a defensible accuracy claim.
> For that, run the AVP benchmark below.

## Benchmark

For a defensible accuracy number, Beatrice ships a runner that measures its
classifier against the **AVP ("Amateur Vocal Percussion") dataset** (Delgado et
al., Zenodo, CC-BY) — 28 participants, ~9,780 annotated utterances, using the
*exact same 4-class taxonomy* Beatrice targets. Published lineage for context:
the SOTA on AVP is ≈0.90 (a personalized CNN + kNN); classical hand-crafted
heuristics land around ≈0.84. Beatrice's rule-based classifier is measured
honestly here — whatever it scores, it scores.

**The dataset is not bundled** (it is large and separately licensed). Download
it from Zenodo, extract it, and point the runner at the folder.

### Expected layout

```
<dataset>/
  <participant_id>/          one directory per participant (28 total)
    <name>.wav               recording(s)
    <name>.csv               annotation, SAME stem as its .wav
```

Each annotation CSV is `<onset_seconds>,<class_label>` per row (a header row is
tolerated and skipped). AVP labels map to Beatrice classes as:

| AVP label | Meaning | Beatrice class |
|-----------|---------|----------------|
| `kd`  | kick drum     | BilabialPlosive |
| `sd`  | snare drum    | Click |
| `hhc` | closed hi-hat | HihatNoise |
| `hho` | open hi-hat   | HihatNoise *(folded — Beatrice has no open-hat class; counted separately in the report)* |

### Protocol

Accuracy is **participant-wise** (matching Delgado et al.): the mean over
participants of each participant's per-utterance accuracy. The report shows two
columns side by side, both scored on the **same held-out eval set**:

1. the rule-based heuristic classifier (no personalization), and
2. a per-participant kNN calibration — the first *N* utterances per class per
   participant (default 5) build that participant's profile and are **excluded**
   from that participant's eval set; every remaining utterance is scored.

### Reproduce

```bash
cd src-tauri
cargo run --release --bin benchmark -- --dataset ~/datasets/AVP --out avp-results.md
cargo run --release --bin benchmark -- --help   # full layout + option docs
```

### Results

_Not yet run — the AVP dataset must be downloaded first._ The `--out` file is a
ready-to-paste markdown table (overall participant-wise accuracy for heuristic
vs calibrated, plus per-class precision/recall and the `hho`-folding caveat).
Paste it here once the dataset is available; do not hand-edit the numbers.

## Themes

Themes define the harmonic personality of the output:

| Theme | Key | Progression | Character |
|-------|-----|------------|-----------|
| **Blade Runner** | D minor | Dm → Bb → F → C | Dark, atmospheric, Vangelis-inspired |
| **Stranger Things** | C minor | Cm → Bb → Ab → Bb | Retro 80s synth |

The bass line follows the chord progression with root-fifth alternation. Pad chords resolve to the active triad. Arpeggios can be driven by your hi-hat rhythm (ArpDrive mode).

## Song Mode

When you hit Play, Beatrice doesn't just loop your beat — it builds a full 16-bar arrangement:

| Section | Bars | What Plays |
|---------|------|------------|
| **Intro** | 1-4 | Kick + Hi-hat only |
| **Build** | 5-8 | + Snare + Bass (harmonic progression enters) |
| **Drop** | 9-12 | Full arrangement with Pads + Arp |
| **Outro** | 13-16 | Bass only, fading out |

A 4-second beatbox becomes a 30-second evolving track.

## Jam Mode

Jam Mode is a **sketch instrument**: press START and beatbox live while Beatrice
listens. Each sound you make flashes as a class-colored tile the instant it's
detected, driving a live waveform — you **see the band form as you jam**. When
you've got something, hit **CAPTURE** and the last few seconds are handed to the
full offline pipeline, which arranges them into a playable, exportable track.

### Honest latency — the gate we set and the gate we failed

We held Jam Mode to a hard rule up front: **acoustic mouth-to-sound P95 ≤ 60ms**
would earn *full live synth* (hear the synth react under your voice in real
time); anything slower would ship as *visual jam* instead. We then measured it
on real hardware — most projects never publish this number at all.

**Outcome: NO-GO for live synth. Jam Mode ships in visual form.** On this
machine's built-in mic + speakers the shipping detector measures **P95 ≈ 165ms
mouth-to-sound** (P50 ≈ 109-162ms) — ~2.7x over the 60ms budget. Two things
stack to make that number:

- **~60ms** is the acoustic round trip of commodity built-in laptop audio (DAC
  out → speaker → air → mic → ADC in → input buffer). Not something software can
  move.
- **~100ms** is the detector's *own* design: the streaming classifier defers
  each onset by a 100ms window so its live classification matches the offline
  pipeline within ±20ms. The compute itself is sub-millisecond; the wait is
  deliberate.

So live synth would feel like beatboxing over a ~165ms echo — unplayable. The
honest form is **visual**: instant flashes and capture, no fake "live" synth
that lags. Full numbers, methodology, and the 3-run re-measure are in
[docs/latency.md](docs/latency.md).

> The detector floor alone (measured synthetically, no speakers or mic) is
> already ~112ms P95 — it exceeds the 60ms budget before any acoustic path. A
> future full-jam build needs a *different*, edge-triggered detector, not just
> better hardware. That's documented, not hand-waved.

### The flow: calibrate → jam → capture → export

1. **Calibrate (optional, ~20s).** Hit TEACH and make each of your 4 sounds 5×.
   Beatrice builds a per-voice kNN profile so *your* "tss" reads as a hi-hat even
   if the generic heuristic disagrees. A HEURISTIC/YOURS toggle flips
   classification live — you **see** subsequent tiles change color as your
   profile takes over. The profile persists across sessions (localStorage; also
   registered with the native backend so the offline pipeline uses it too).
2. **Jam (~30s).** Beatbox. Sounds flash as they're detected.
3. **Capture.** The last few seconds of mic audio are encoded to WAV.
4. **Arrange.** That WAV runs through the exact same pipeline as an upload —
   detection, classification, tempo, grid, harmonic arrangement, Song Mode.
5. **Export** the result as MIDI or WAV, same as any other track.

### Real vs. mock — what actually runs where

Be precise about this, because Beatrice has a browser demo with a mock backend:

- **Jam detection is genuinely in-browser and real, everywhere.** The live
  detector is the actual Rust `StreamingDetector` compiled to WASM (~110KB
  gzipped), running on the audio render thread in an AudioWorklet. In the browser
  demo it's the *same* WASM — the mock's fake DSP is **not** in the jam path.
  What flashes on screen is a real spectral-flux onset detector classifying your
  real microphone audio.
- **The offline arrangement pipeline is still mocked in the browser demo.** When
  you CAPTURE in the browser demo, the resulting WAV is analyzed by the mock
  (which fabricates events from byte length), so the arrangement is illustrative,
  not a real analysis of what you played. **In the native app**, CAPTURE runs the
  real Rust pipeline end-to-end, so the arrangement reflects your actual beat.

There's a step-by-step walkthrough in [docs/demo-script.md](docs/demo-script.md).

## Tech Stack

- **Frontend**: React 19, TypeScript, Zustand, Three.js (R3F), Framer Motion, Vite 7
- **Backend**: Rust (Tauri 2), SQLite (rusqlite), hound (WAV), cpal (recording), realfft (FFT), midly (MIDI), fundsp (DSP)
- **Live jam**: the `beatrice-dsp` crate compiled to WASM (`wasm-pack`), running the causal `StreamingDetector` inside a WebAudio AudioWorklet — the same Rust DSP as the CLI and native backend
- **Audio**: WebAudio API with layered synthesis, convolution reverb, ping-pong delay, sidechain ducking
- **Design**: Neo-brutalist CSS with bold borders and high-contrast colors

## Getting Started

### Browser mode (frontend only, mock backend)
```bash
npm install
./run.sh
# Opens at http://localhost:1420 — click "TRY DEMO" to see the full pipeline
```

### Native mode (full Tauri app with Rust backend)
```bash
npm install
./run.sh tauri
# Requires Rust 1.77+ toolchain
```

### Analyze a WAV file directly
```bash
cd src-tauri
cargo run --bin analyze -- path/to/your/beatbox.wav
```

### Run tests
```bash
# Rust: 140 unit tests (incl. the AVP benchmark's mapping/split logic) + 10 integration tests
# The integration tests read fixtures from test-audio/, so generate them first.
node scripts/generate-test-audio.mjs
cd src-tauri && cargo test

# Frontend: 9 Vitest tests + type check
npm test
npx tsc --noEmit
```

### Generate deterministic test audio
The `test-audio/` directory is not committed — it is generated on demand. The
script writes deterministic WAV fixtures (kick, hihat, snare, hum, an 8-bar
progression, and the composite `test-pattern.wav` the integration tests read).
```bash
node scripts/generate-test-audio.mjs
```

## Architecture

```
src/                          # React frontend
  App.tsx                     # Pipeline orchestration, state machine
  hooks/
    useAudioPlayback.ts       # WebAudio synthesis, Song Mode, velocity-to-filter
    useAudioRecorder.ts       # Mic recording via Tauri IPC
  components/
    Explainability/           # Timeline, DecisionCard, ArrangementLanes
    Theme/                    # Theme selector with harmonic metadata
    Groove/                   # Grid, quantize, tempo controls

src-tauri/src/                # Rust backend
  audio/                      # WAV ingestion, onset detection (spectral flux +
                              # broadband energy), feature extraction
  events/                     # Heuristic classifier (spectral centroid, ZCR,
                              # band energy, crest factor) + KNN calibration
  groove/                     # Tempo estimation (all-to-all IOI), musical grid,
                              # quantization with swing
  arranger/                   # Harmonically-aware arrangement (chord-resolved
                              # bass, triadic pads, rhythmic arp puppeteering)
  themes/                     # Scale families, chord progressions, bass/arp
                              # patterns, FX profiles
  state/                      # SQLite persistence, file storage, JSONL traces
```

## License

MIT
