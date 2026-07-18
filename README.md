# Beatrice

> Beatbox into your mic. Get a synth beat out.

[![CI](https://github.com/bobbyrathoree/beatrice/actions/workflows/ci.yml/badge.svg)](https://github.com/bobbyrathoree/beatrice/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-1.77+-orange?logo=rust&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

Beatrice is a desktop app that transforms beatbox performances into harmonically intelligent synthesizer arrangements. You provide the rhythm with your mouth — kicks, hi-hats, snares, and hums — and Beatrice detects each sound, classifies it, estimates your tempo, and arranges everything into a multi-track composition that follows real chord progressions.

<p align="center">
  <img src="docs/logo.png" alt="Beatrice Logo" width="300">
</p>

<p align="center">
  <a href="https://bobbyrathoree.github.io/beatrice/"><strong>▶ Try the live demo</strong></a>
  &nbsp;·&nbsp; runs the full pipeline in your browser — click <strong>TRY DEMO</strong> and press play
</p>

> The hosted demo runs the frontend against a mock backend (a canned beatbox
> performance), so the detect → classify → arrange → play → export flow works
> end-to-end with audio, no install. The native app runs the real Rust DSP
> backend — see [Getting Started](#getting-started).

## Contents

- [How It Works](#how-it-works)
- [Screenshots](#screenshots)
- [Sound Classification](#sound-classification)
- [Benchmark](#benchmark)
- [Themes](#themes)
- [Song Mode](#song-mode)
- [Jam Mode](#jam-mode)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [License](#license)

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

Under the hood, percussive sounds are classified by a compact Gaussian model
over 20 MFCCs + zcr + crest factor, fitted on the AVP dataset (9,777 labeled
utterances from 28 people) and embedded in the binary (~2 KB); sustained
signals are gated to a rule-based hum detector. See
[Benchmark](#benchmark) for measured accuracy and the model's design notes.

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
al., Zenodo, CC-BY) — 28 participants, ~9,780 annotated utterances. AVP's
native taxonomy is kick / snare / closed hi-hat / *open* hi-hat; Beatrice has
no open-hat class (both hats fold into HihatNoise) and its fourth class,
HumVoiced, does not exist in AVP — so this benchmark is effectively a
**3-way percussion task**, and published AVP numbers (the ≈0.90 personalized
CNN SOTA, the ≈0.84 classical MFCC + kNN baseline) are measured on the native
4-class task and are not directly comparable. Beatrice's classifier is
measured honestly here — whatever it scores, it scores.

**The dataset is not bundled** (it is large and separately licensed). Download
it from Zenodo, extract it, and point the runner at the folder.

### Expected layout

```
<dataset>/
  <participant_id>/          one directory per participant (28 total)
    <name>.wav               recording(s)
    <name>.csv               annotation, SAME stem as its .wav
```

The Zenodo zip ships split by modality (`Personal/Participant_N` and
`Fixed/Participant_N`); merge both modalities into one directory per
participant first — symlinks are fine:

```bash
unzip AVP_Dataset.zip && mkdir -p AVP
for i in $(seq 1 28); do
  mkdir -p AVP/Participant_$i
  ln -s "$PWD"/AVP_Dataset/{Personal,Fixed}/Participant_$i/*.{csv,wav} AVP/Participant_$i/
done
```

Each annotation CSV is `<onset_seconds>,<class_label>,...` per row (extra
columns such as the v4 phoneme labels are ignored; a header row is tolerated
and skipped). AVP labels map to Beatrice classes as:

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

Run 2026-07-15 against AVP v4 (Zenodo record 5036529): 28 participants, 9,777
annotated utterances, 9,357 scored on the held-out eval set (1 unknown-label
row skipped; 2,204 open-hat `hho` utterances folded into HihatNoise). Full
generated report: [docs/avp-results-2026-07-15.md](docs/avp-results-2026-07-15.md).

| Classifier | Participant-wise accuracy |
|---|---|
| Rule heuristic (v1 classifier, no calibration) | 65.8% |
| Per-participant kNN on 7 scalar features (v1 calibration, retired) | 60.2% |
| **Gaussian MFCC model, user-agnostic (LOPO)** — ships as default | 79.7% |
| **Gaussian MFCC model + MAP calibration (LOPO, tau=10)** — ships as "teach Beatrice" | **81.6%** |

| Class | Heuristic P | Heuristic R | Gaussian P | Gaussian R |
|---|---|---|---|---|
| kd → BilabialPlosive | 76.2% | 72.4% | 91.1% | 85.5% |
| hhc/hho → HihatNoise | 67.1% | 85.2% | 81.2% | 87.3% |
| sd → Click | 43.8% | 20.8% | 70.8% | 65.8% |
| (none) → HumVoiced | 0.0% | — | 0.0% | — |

**How the shipping classifier works.** The first benchmark run exposed the
v1 design: the rule heuristic scored 65.8% (snare recall 20.8% — most snares
misread as kick or hi-hat) and the 7-scalar-feature kNN calibration actively
*hurt* (60.2%). The fix is a **hybrid**: 20 MFCCs + zcr + crest factor feed a
diagonal-covariance Gaussian classifier fitted on all 28 AVP participants
(~2 KB of JSON, embedded in both the native binary and the WASM worklet), with
a sustained-signal gate (crest < 2.2 ∧ zcr < 0.15, 0.04% false-fire on AVP)
routing hums to the heuristic since AVP has no hum class. Calibration is MAP
mean adaptation — 5 labeled samples per class shift the factory means about a
third of the way toward the user's voice — worth +1.9 points on average
(participant-wise; individual participants can still lose accuracy, which the
tau=10 prior bounds but does not eliminate).

**Honest read.** The Gaussian numbers are leave-one-participant-out: each
participant is scored by a model that never saw their voice. 81.6% sits above
the published user-agnostic HMM baseline (≈0.73), below the personalized CNN
SOTA (≈0.90); the classical "MFCC + kNN ≈ 0.84" lineage number is boxeme-wise
on a different split, so it is not directly comparable to our participant-wise
protocol. Snare remains the hardest class (65.8% recall — snare imitations
genuinely overlap hi-hats in timbre), and HumVoiced is unmeasurable on AVP by
construction. The remaining ~8-point gap to SOTA is the roadmap's
CNN-embedding classifier (AVP-LVT, 0.90 bar).

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
   Beatrice MAP-adapts its factory Gaussian model toward *your* voice, so your
   "tss" reads as a hi-hat even if the stock model disagrees. A FACTORY/YOURS
   toggle flips classification live — you **see** subsequent tiles change color
   as your profile takes over. The profile persists across sessions
   (localStorage; also registered with the native backend so the offline
   pipeline personalizes with it too).
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
