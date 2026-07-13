# Beatrice v2 — Design Spec

**Date:** 2026-07-13
**Status:** Draft for review
**Inputs:** Full evaluation (`docs/evaluation-2026-07-13.md`, 70 confirmed findings, grade C+), competitive market research (2026-07, summarized in §1.2), owner decisions (§1.3).

---

## 1. Context

### 1.1 Where v1 stands

The evaluation found a system whose *listening half is real and whose output half is half-real*:

- **Works, verified:** onset detection + 4-class classification on real recordings; tempo estimation core; quantization math; music-theory core (scales, triads, `get_chord_at_time`); in-app WebAudio playback with Song Mode; SQL persistence layer.
- **Broken, verified:** production TS build (31 errors); MIDI export (all lanes on GM percussion channel 9); WAV export (renders silence, reports success); native session history (snake_case IPC args vs Tauri v2 camelCase); AUTO tempo button (wrong arg shape, clobbers BPM to 120).
- **Core product flaw:** the arranger template-gates events instead of following the performance. On `real-beatbox-2.wav`, 16 detected events → 0 kicks, 0 snares, 1 of 5 hi-hats in the arrangement. Contributing causes: grid anchored at t=0 (phase alignment computed by tempo estimation is discarded), no tempo octave correction, hard template gating.
- **Fake or no-op:** explainability card (fixed template, inverted early/late label), FEEL=Halftime, SWING slider (unless FEEL=Swing), Calibration UI (never mounted), WAV export.

### 1.2 Market position (research summary)

- **The concept occupies unoccupied space.** Vochlea Dubler 2 ($99) — the only direct beatbox→MIDI competitor — stops at raw MIDI triggers. DAW audio-to-MIDI (Ableton, Logic, Melodyne) outputs raw notes, no harmony. Arrangers (Band-in-a-Box, Logic Session Players, Scaler) require *typed* chords. Generative AI (Suno/Udio/MusicGen) ignores the user's actual performance. **No shipping product turns your own beatbox into an editable, harmonically intelligent multi-track arrangement.**
- **Classification bar:** AVP dataset (28 users, 9,780 utterances) uses Beatrice's exact 4-class taxonomy and is free. Published SOTA: 0.90 accuracy (CNN syllable embeddings + per-user kNN, Delgado 2022); classical-heuristic lineage (Beatrice's) ≈ 0.84. Per-user personalization is worth ~+15 points; few-shot from ~5 examples is proven (Wang 2020, prototypical networks).
- **Latency bar for live play:** ≤10ms action-to-sound ideal, 20ms breaking point (Wessel & Wright). No vendor publishes latency numbers.
- **Second unoccupied space:** ready-to-open DAW-session export (.als/Logic). No product does this. (Out of scope for v2; named as roadmap next act.)

### 1.3 Owner decisions

| Decision | Choice |
|---|---|
| Direction | Full v2, phased: harden → arrangement engine → real-time |
| Purpose | **Portfolio / showcase piece** |
| Headline demo | **Live beatbox jam mode** |
| Budget | ~1–2 months part-time |
| Real-time architecture | **Rust DSP → WASM in AudioWorklet** (one crate for CLI/native/browser) |

### 1.4 Positioning statement

> Beatrice is the offline **compose-quality** beatbox instrument — it spends compute a live tool can't (look-ahead onset detection, global tempo/harmony optimization) to turn a 10-second beatbox into an editable arrangement — plus a live **jam sketch** mode that shows the same engine responding to your mouth in near-real-time. Not a <10ms performance instrument, and honest about it: we publish our measured latency, which no competitor does.

---

## 2. Goals / Non-Goals

**Goals**
1. Every advertised feature works or is removed (no fake success states).
2. The arrangement provably follows the user's performance (groove fidelity, per-note provenance).
3. Live jam mode: mic → classified event → synth voice, measured and published latency, same Rust DSP everywhere (scope gated by the §5.0 feasibility spike).
4. Defensible accuracy claims: benchmarked on AVP with participant-wise splits, published in README.
5. A reviewer can clone, `npm ci && npm run check`, and everything is green; the browser demo runs the *real* classifier (WASM), not a mock.

**Non-Goals (v2)**
- <10ms live-performance latency; VST3/AU plugin; DAW-session (.als) export; hum-to-song / melodic input; new themes beyond the existing two; mobile.

---

## 3. Phase 1 — Make everything advertised true (~2 weekends)

### 3.1 CI + contract generation (the root fix)
- GitHub Actions: `tsc --noEmit && vite build`, `cargo test`, `cargo clippy -- -D warnings`, Playwright smoke of the demo path. Every push. Add `npm run check` running the same set locally (the Goals §2 reviewer command).
- Adopt **`tauri-specta`** to generate typed command bindings — not just payload types but the full `invoke` wrappers with correct top-level argument names. This is the root fix for *both* drift classes found in the audit: struct-shape drift (the three conflicting `Arrangement` interfaces, 31 TS errors) *and* arg-casing drift (the snake_case/camelCase breaks in `list_runs_for_project`/`get_event_decisions`, which payload-type generation alone would not catch). Generated `src/types/generated/` + `src/bindings.ts` are the only way the frontend talks to Rust; a CI step regenerates and fails on diff.
- Rewrite `PlaybackControls.tsx` HUD chord logic (currently Rust-syntax pseudocode with hardcoded chord names) to derive chords from the actual `Theme` struct.

### 3.2 Export fixes
- **MIDI:** melodic lanes → channels 0–3 (bass 0, pads 1, arp 2), drums stay on 9. Fix overlapping same-pitch note-on/off pairing (track open notes per pitch). Golden-file round-trip test: export → parse with `midly` → assert exact pitch/velocity/tick sequences.
- **WAV:** render via `OfflineAudioContext`. Prerequisite refactor: extract a pure `scheduleArrangement(ctx: BaseAudioContext, destination: AudioNode, arrangement, options)` from `useAudioPlayback` — the current hook uses module-global FX nodes, connects directly to `ctx.destination`, and mixes in live-only state (RAF, AudioContext lifecycle), none of which transfers to offline rendering as-is. Fix the export-duration formula (`ExportControls.tsx:96` uses `bar_count*4*60/bpm`, ignoring the expanded song's `total_duration_ms`). Delete the silent Rust `render/` placeholder module. **Stem export is a stretch goal, not free**: master reverb/delay and sidechain ducking couple lanes through shared buses, so per-lane renders need explicit design (dry-stem + shared-FX-return, or per-stem FX). Ship master-only first.

### 3.3 IPC + persistence fixes
- Fix camelCase arg names (`list_runs_for_project`, `get_event_decisions`); make the browser mock schema-strict (unknown command or arg shape → loud throw in dev). The mock is a Phase 1 stopgap only — Phase 3's WASM build replaces its DSP entirely (§5.1).
- Fix `create_project` throwaway-UUID file orphaning; remove row-mapper `unwrap()`s (Mutex poisoning); sanitize `store_file` filenames (path traversal); set a real CSP.
- Fix `GrooveControls` estimate_tempo arg shape; populate `pipelineResult.duration_ms` (kills the hardcoded 10s waveform).
- Recorder hook: unmount cleanup + working 30s auto-stop.

### 3.4 Honesty pass
- Remove or hide: Calibration UI (returns in Phase 3), FEEL=Halftime, SWING slider (until wired), fake explainability fields.
- Fix theme metadata (Stranger Things is C minor in code; make README/UI/Rust agree — pick one truth in Rust).
- README: real test count, real fixture provenance (`generate-test-audio.mjs` gains `test-pattern.wav` + commit fixtures or generate in CI), error toasts instead of silent console.error / `[object Object]`.

**Exit criteria:** CI green from fresh clone; exported MIDI opens correctly in a DAW (manual verify in GarageBand/Ableton trial); WAV export is audible; native app session history works; no UI control is a no-op.

---

## 4. Phase 2 — Groove-faithful arranger (~2–3 weekends)

### 4.1 Grid phase anchoring
`TempoEstimate.beat_positions_ms` (already computed, currently discarded) anchors the grid: `Grid` gains `phase_offset_ms`. Quantization and `get_chord_at_time` use the anchored grid. Leading silence / anacrusis no longer shifts every downbeat.

### 4.2 Tempo octave correction
After peak selection, score {½×, 1×, 2×} candidate BPMs against onset alignment (`score_beat_alignment` exists) and prefer the candidate in the theme's stated BPM range when scores are close. Fix the histogram edge-bin and plateau bugs found in the audit. Confidence becomes real: derived from alignment score, not cosmetic ~100%.

### 4.3 Fidelity slider (replaces hard template gating)
`fidelity: f32` (0.0–1.0) replaces the binary keep/delete of `should_place_on_beat`. **Fully deterministic** — the same performance and settings always produce the same arrangement (exports must be reproducible):
- **1.0 "Follow me":** every detected event produces its mapped instrument note at its quantized position; templates only shape velocity/duration.
- **0.0 "Produce for me":** all hits snap fully onto template positions (off-template hits *move* to the nearest template slot and merge if colliding — never silently deleted, fixing the current discard behavior).
- **Between:** off-template hits are linearly pulled toward their nearest template slot by (1−fidelity), and their velocity is attenuated in proportion to their distance from the template grid.
Default 0.8. No randomness anywhere in the arranger path. The B-Emphasis slider stays as-is.

### 4.4 Per-note provenance (real explainability)
Every `ArrangedNote` already carries `source_event_id`; surface it end-to-end. DecisionCard shows the classifier's *actual* `all_scores` (currently discarded) and the correct early/late label. Timeline gains an input-vs-arrangement side-by-side lane — the "it follows YOU" demo asset.

### 4.5 AVP benchmark
`cargo run --bin benchmark -- path/to/AVP` — participant-wise splits, per-class accuracy table printed and saved as JSON/markdown for the README. Wire the existing (currently orphaned) kNN calibration into the benchmark to report heuristic vs. per-user-calibrated numbers. Target: honest numbers (~0.8x expected), not inflated ones.

**Exit criteria:** `real-beatbox-2.wav` at fidelity 1.0 produces kick/snare/hihat notes for ≥90% of detected events at correct positions; tempo octave test corpus passes; README carries the AVP table.

---

## 5. Phase 3 — Live jam mode (~3–4 weekends)

### 5.0 Gate: latency + feasibility spike (first weekend of Phase 3)
Phase 3 starts with a **spike, not a build**: minimal WASM detector in an AudioWorklet, hardcoded thresholds, one synth voice, and a loopback latency harness. Measure P50/P95 mouth-to-sound. Decision gate: if P95 ≤ ~60ms, proceed to 5.1–5.3; if not, jam mode ships as "visual event feedback + capture" (no live synth promise) and the budget moves to §5.3-capture polish.

### 5.1 Streaming DSP core
The offline detector is *not* trivially streamable: it computes adaptive thresholds from whole-file flux statistics (mean/std/median over the complete recording, `features.rs:466-478`) and event durations from next-onset/file-end. So the crate exposes **two APIs, explicitly not bit-identical**:

```rust
pub fn analyze_offline(audio: &AudioData, cfg: &OnsetConfig) -> Vec<Event>;    // unchanged behavior

pub struct StreamingDetector { /* ring buffer, STFT state, rolling threshold window */ }
impl StreamingDetector {
    pub fn new(sample_rate: u32) -> Self;
    /// Events may be emitted 1-2 hops after their true onset (peak confirmation);
    /// classification may be provisional then refined.
    pub fn push(&mut self, samples: &[f32]) -> Vec<LiveEvent>;
}
```
The streaming path uses a rolling window (~2s) for adaptive thresholds instead of whole-file stats. The equivalence test is **tolerance-based, not exact**: on the fixture corpus, streaming must find ≥95% of offline onsets within ±20ms with the same class. Offline (`analyze_offline`) stays the source of truth for capture/arrangement quality. CLI, Tauri commands, and WASM all consume this crate; the tauri-mock's fake DSP dies.

### 5.2 WASM + AudioWorklet
- `wasm-pack` build of `beatrice-dsp`; loaded inside an `AudioWorkletProcessor` (128-sample quanta @ 48kHz = 2.67ms).
- Worklet posts `LiveEvent`s to the main thread; existing synth voices in `useAudioPlayback` trigger immediately.
- **Honest latency budget:** the current detector needs a 2048-sample window (~43ms @ 48kHz) plus 512-sample hops and local-max peak confirmation, plus worklet→main-thread message jitter. Realistic mouth-to-sound is **~40–80ms** with the detector as-is; reaching "jam-sketch feel" (<60ms) likely needs a smaller live analysis window (e.g. 512/256) accepting lower classification confidence, with the offline pass re-classifying on capture. The spike (§5.0) decides. Whatever we measure — P50 and P95 — is published in the README; no competitor publishes any number, so honest 50ms beats implied 10ms.
- Positioning guardrail: jam mode is a **sketch instrument** ("hear the band react as you jam"), never marketed as a performance instrument — that's Dubler's turf and the research says our moat is the arrangement intelligence, not trigger latency.

### 5.3 Jam experience
- **Jam screen:** live waveform, event flashes per class, the arrangement engine running in "rolling" mode — a 4-bar ring buffer of recent events, re-arranged each bar with the Phase 2 arranger, so the backing track *evolves as you play*.
- **Capture:** one button freezes the last N bars into the normal offline pipeline → full arrangement + working MIDI of what you just jammed.
- **Few-shot calibration (resurrected):** "Teach Beatrice your sounds" — 5 taps per class, stored via the existing kNN calibration Rust code (now reachable since the whole crate is in the browser). Toggleable heuristic vs. personalized, with live accuracy feedback.

**Exit criteria:** demo video: calibrate (20s) → jam (30s, audible synth response) → capture → play full arrangement → export MIDI, open in DAW. Measured P50/P95 latency in README. (If the §5.0 gate failed: demo video is jam-with-visual-feedback → capture → arrangement, and the README states why.)

---

## 6. Testing strategy

| Layer | Approach |
|---|---|
| Rust DSP | existing unit tests + tolerance-gated streaming-vs-offline test (≥95% of offline onsets within ±20ms, same class) |
| MIDI | golden-file round-trip (pitch/velocity/tick exact) |
| Contracts | tauri-specta binding regeneration diff check in CI |
| Accuracy | AVP benchmark bin, participant-wise |
| Frontend | Vitest for hooks (playback scheduling math, recorder cleanup); Playwright demo-path smoke in CI |
| Latency | loopback measurement harness (Phase 3) |
| Fixtures | `generate-test-audio.mjs` generates *all* referenced files incl. `test-pattern.wav`; CI regenerates |

## 7. Risks & cut lines

| Risk | Mitigation / cut |
|---|---|
| Latency spike fails the ≤60ms gate | Jam mode becomes "visual feedback + capture"; headline demo shifts to the fidelity-slider A/B (§4.4) — the arrangement story stands on its own |
| WASM/Worklet + Vite integration eats the budget (worklet module loading with bundlers is notoriously fiddly) | Spike surfaces this in weekend one; fallback: run WASM detector in a plain Worker with ScriptProcessor-style capture (higher latency, but ships) |
| Streaming refactor destabilizes offline accuracy | offline path (`analyze_offline`) is untouched; streaming is a parallel API with tolerance-gated tests |
| AVP benchmark embarrasses the heuristic | that's fine — honest numbers + per-user calibration delta is the portfolio story |
| Rolling re-arranger sounds chaotic | re-arrange only at bar boundaries, crossfade lanes; cut to "static template + live triggers" if needed |
| Budget compresses (likeliest: Phase 3 is realistically 1–2 months alone if built in full) | Cut order: rolling re-arrangement → stems → few-shot calibration → live synth triggering (keep visual jam + capture) → (never cut: CI, exports, fidelity slider) |

**Honest budget note:** an external design review (GPT-5.5) assessed full Phase 3 at 1–2 months by itself. The spike-gate structure (§5.0) exists so the 1–2 month total budget can still ship a coherent v2 even if jam mode lands in reduced form: Phases 1+2 alone deliver the unoccupied-market story (groove-faithful arrangement + working exports).

## 8. Roadmap beyond v2 (named, not designed)

DAW-session export (.als with stems + tempo map — unoccupied market space), CNN-embedding classifier trained on AVP-LVT (0.90 bar), VST3 plugin, hum-to-song melodic input.
