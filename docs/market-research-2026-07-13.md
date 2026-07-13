# Competitive Landscape: Voice/Beatbox → Instrument Software (2025–2026)

*Researched 2026-07-13 (5 parallel research streams). Basis for the v2 design spec's market positioning.*

## 1. Per-Competitor Capability Matrix

### A) Real-time voice/beatbox → MIDI (closest direct competitors)

| Product | Real-time? | Latency | Detection tech | Personalized training | Beatbox/drum | Melodic | Format | Price | OS |
|---|---|---|---|---|---|---|---|---|---|
| **Vochlea Dubler 2** | ✅ live trigger | No published ms; reviewers say "snappy"; pitch lags more | "AI-powered" (architecture undisclosed) | ✅ up to 12 takes/sound, 8 pads/profile; mic calibration <1 min | ✅ standout strength, best at 3–5 triggers | ✅ mono pitch, chords, bend, 4 CC via vowel trackers | Standalone + "MIDI Capture" plugin (VST3/AU, no Pro Tools) | **$99** | mac 10.13+, Win 10+ |
| **imitone** | ✅ live | "<30ms" low voice | "Resonator" DSP | ❌ | ❌ melodic only | ✅ pitch + expression | Standalone + VST (Win-only plugin) | ~$29+ PWYW | mac/Win, beta |
| **Jam Origin MIDI Guitar 3** | ✅ live | "low" | polyphonic tracking | ❌ | ❌ | guitar/bass — no voice | Standalone+VST/AU+iOS, MPE | $149.95 | mac/Win/iOS |
| **Dodo MIDI** | ✅ live | "low" | — | ❌ | ❌ | ✅ mono only | VST3/AU | Free | mac/Win |

Dubler 2 is the *only* true beatbox-to-MIDI competitor. Its weakness pattern mirrors Beatrice's (percussive robust, melodic fuzzy). No competitor publishes a hard latency number.

### B) Offline DAW audio-to-MIDI (extraction, not arrangement)

| Product | Converts | Notes | Price |
|---|---|---|---|
| **Ableton Live 12** | Drums→MIDI, Harmony, Melody | Docs explicitly name "beatboxing"; raw MIDI, no harmony | $349/$749 |
| **Logic Pro 12** | Drum replace/double; Flex Pitch→MIDI | One drum instrument at a time | $199.99 |
| **Melodyne 5** | Audio→MIDI, polyphonic (DNA) | MIDI export needs Assistant+ ($249) | $99–$699 |
| **Samplab 2** | Audio→MIDI, chords, stems | Shutting down Sept 2026 | ~$9.99/mo |
| **AudioShake** | Stem separation only (no MIDI) | Cloud/API | ~$20–60/mo |

### C) AI generative newcomers (2024–2026)

| Tool | Audio/hum input? | True melody conditioning? | Output | Price |
|---|---|---|---|---|
| **Google Music AI Sandbox / Lyria 2** | ✅ | ✅ demos beatbox→drum-loop, hum→track | Full tracks, editable timeline | US-only waitlist (not shipping) |
| **Meta MusicGen-melody** | ✅ audio file | ✅ genuine (chromagram) | Raw audio, no MIDI/stems | Free/open (non-commercial weights) |
| **Suno (v4.5+)** | ✅ upload/cover | ⚠️ style-transfer, not note-level | Song + stems (paid) + rough MIDI | Free/$8/$24 |
| **Udio** | ✅ remix | ⚠️ remix only | Song + 4 stems | Free/$10/$30 |
| **Stable Audio 2/3** | ✅ transform | ⚠️ style transfer | No MIDI | Free web + API |
| **Jamahook** | ✅ but matches existing loops | matches full mix | royalty-free loops | €3.99/mo–€39.99 |

Legal: Suno & Udio hit by RIAA suit (June 2024); both signed label deals late 2025. Google Lyria watermarks with SynthID.

### D) Arrangement / accompaniment SOTA

| Tool | Follows user's harmony? | Output | Price |
|---|---|---|---|
| **Band-in-a-Box 2026** | ✅ chords→real-musician phrases; 710+ RealTracks | Audio + MIDI + stems | $129–$694 |
| **Logic Session Players** | ✅ follow Chord Track natively | Editable regions→MIDI | Bundled in $199.99 |
| **Scaler 3** | ✅ detects chords, auto voice-leads | MIDI + 50 sounds | ~$59–79 |
| **DeepBach** (research) | ✅ harmonizes user melody | MIDI/MusicXML; ~50% of 1,272 listeners judged output as real Bach | Free/open |
| **Suno/Udio/AIVA** | ❌ free generation | finished audio | — |

The market splits: (a) tools that **respect the user's chords/rhythm** and output MIDI (BiaB, Session Players, Scaler, DeepBach) vs (b) tools that **generate freely** and output finished audio. Beatrice is in camp (a); the bar there is voice-leading quality and phrase realism.

### E) Classification tech — academic SOTA

- **Datasets:** AVP (Amateur Vocal Percussion) — 28 users, **9,780 utterances**, the **exact 4-class taxonomy Beatrice uses** (kick/snare/closed-hihat/open-hihat); AVP-LVT merged = 5,714 boxemes (62,854 augmented). Also BaDumTss, Stowell Beatbox (7,460), VocalSketch, VimSet.
- **Accuracy SOTA:** Delgado et al. 2022 — CNN syllable-level embeddings + per-user kNN = **0.899 participant-wise / 0.874 boxeme-wise**. Classical MFCC+kNN baseline = **0.84**. User-agnostic HMM = 0.725. Personalization ≈ +15 points.
- **Few-shot:** Wang et al. 2020 (ISMIR) — Prototypical Network learns a drum class from **5 user examples**, matches fully-supervised CRNN.
- **Onset:** SuperFlux (5ms accuracy, 30× realtime, causal). On AVP, classical HFC/Complex-domain F=0.94–0.95 beat neural (0.89) and were 27–38× faster; neural gave tighter timing (9–10ms vs 17–21ms). 90ms min-onset-separation suppresses vowel false-onsets.
- **Playable latency:** Wessel & Wright — **≤10 ms action-to-sound, ≤1 ms jitter**; 20 ms is the breaking point. Vocal percussion is harder than pads (diffuse onsets).

## 2. The 5 capability gaps (hobby → industry-leading)

1. **Personalized, ML-based classification** — CNN/embedding classifier + few-shot personalization (0.90) vs fixed heuristics (~0.84 lineage).
2. **A published, defensible latency & real-time story** — either <10ms live triggering or explicitly own the offline compose-quality niche.
3. **Rigorous benchmarked accuracy** — AVP-LVT participant-wise splits, not n=3 recordings from one mic.
4. **Plugin format + DAW integration** — standalone AND VST3/AU (AAX) is table-stakes; virtual-MIDI-out.
5. **Rich export** — floor: MIDI drag-and-drop; ceiling: per-instrument stems + MusicXML.

## 3. What would be genuinely NOVEL (nobody ships this)

1. ★ **Beatbox → editable, harmonically intelligent multi-track arrangement, on-device.** Unoccupied. Dubler stops at raw triggers; Ableton stops at raw MIDI; BiaB/Logic need typed chords; Google's Sandbox is cloud/US-only research.
2. ★ **Export a ready-to-open Ableton Live Set (.als)/Logic session with stems + MIDI.** No product in the survey does this.
3. **Few-shot personalization (~5 taps) on-device feeding a harmonic arranger** — Wang 2020 proved the ML; Dubler proved users tolerate training; nobody combines them with arrangement.
4. **Honest offline "compose-quality" positioning** — spend compute a live tool can't; "not real-time, but musically smarter" is defensible and untaken.

## Bottom line

Beatrice's concept (beatbox→harmonic arrangement) sits in genuinely unoccupied space. To be industry-leading rather than a hobby project: (1) ML/personalized classification, (2) AVP-LVT benchmarking, (3) plugin + virtual-MIDI, (4) MIDI/stems/DAW-session export, (5) either <10ms live or own the offline niche. Most defensible bets: on-device beatbox→editable arrangement, and native DAW-session export.
