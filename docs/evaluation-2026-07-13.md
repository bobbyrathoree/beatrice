# Beatrice — Full Evaluation Report (2026-07-13)

Method: hands-on end-to-end testing (build, test suite, `analyze` CLI on 3 real + 2 synthetic + 4 adversarial edge-case WAVs, Playwright drive of the browser UI, MIDI byte-level validation) plus a 10-dimension parallel code audit (85 agents) in which every finding was adversarially verified against source before being accepted. 70 findings confirmed, 5 refuted.

## Verdict

**The listening half is real. The output half is half-real.** Beatrice genuinely detects, classifies, and tempo-tracks real beatbox audio — verified live on the three human recordings. But between the classifier and the user's ears/DAW, a chain of defects means much of what the app *claims* to deliver (faithful arrangement, DAW-ready MIDI, WAV export, session history in the native app, calibration, explainability) is broken, fake, or silently discards the user's performance.

Overall grade: **C+ — an impressive demo, not yet a product.**

| Subsystem | Grade | One-liner |
|---|---|---|
| Onset detection / features | B- | Thoughtful dual-detector DSP; boundary-frame miss is structural |
| Classification | B- | Credible on real audio; calibration path unwired |
| Tempo / grid / quantize | C+ | Correct quantize math; grid ignores its own phase estimate |
| Arranger / harmony | B- | Music theory correct; MIDI export ruins it |
| WebAudio frontend | C+ | Sample-accurate scheduling; recorder leaks, type chaos |
| Rust↔TS contract | C- | The central Arrangement contract has drifted badly |
| State / persistence | C+ | Clean SQL; native IPC arg bugs kill the feature |
| Security / config | C+ | Scoped fs caps; CSP null, path traversal in store_file |
| Test quality | C | 112 green tests; fixtures not reproducible, no frontend tests |
| UX / product | C+ | Polished core loop; several wired-but-fake features |

## What genuinely works (verified first-hand)

- **Detection + classification on real recordings.** All 4 classes verified on the 3 human WAVs. Plosives and hums classify at ~100% confidence and are correct; hi-hats and clicks land at 64–86% (matching the README's honesty about fuzziness). Stereo and 48kHz files handled correctly; silence produces zero onsets.
- **The full Rust pipeline runs**: 104 unit + 8 integration tests pass; `analyze` CLI works on every file I threw at it without a single panic.
- **In-app playback and Song Mode are real.** Watched live: sample-accurate WebAudio scheduling on the AudioContext clock (not setTimeout), HUD advancing INTRO→BUILD, theme switching mid-session, layered synthesis with procedural convolution reverb and sidechain. This is the strongest part of the frontend.
- **Harmony core is musically correct.** Scale intervals, triads, `get_chord_at_time` bar math all verified — no off-by-one at chord boundaries or loop end.
- **Quantization math is correct and well tested**, including grace-note/flam grouping that preserves micro-timing.
- **SQL layer**: fully parameterized, FK cascades, versioned migrations.

## The core product flaw: the arranger discards your performance

On `real-beatbox-2.wav`, the pipeline detects 16 events — and the arrangement contains **0 kick notes, 0 snare notes, and 1 of 5 hi-hats**. Your 4 clean kicks (100% confidence) never trigger a kick drum. Three compounding causes, all confirmed in source:

1. **Grid anchored at absolute t=0** (`grid.rs:296`): tempo estimation computes a real phase-aligned beat grid (`tempo.rs:200-242`), but `App.tsx:249` and the quantizer discard `beat_positions_ms`. Any leading silence misaligns every downbeat.
2. **Template gating** (`drum_lanes.rs:462 should_place_on_beat`): kicks/snares only survive if they land on the template's fixed beats (kick=1&3, snare=2&4). Off-grid = deleted, not moved.
3. **Tempo octave errors** (`tempo.rs:181`): single-strongest-IOI-peak selection with no half/double correction. `real-beatbox.wav` → 160 BPM. Confidence is cosmetic — ~100% on everything.

The pitch is "you provide the rhythm." In reality the template provides the rhythm and your audio is a noisy trigger for it.

## Ship-blockers (P0)

| # | Defect | Evidence |
|---|---|---|
| 1 | **Production build fails — 31 TS errors.** `App.tsx:64` declares `Arrangement { tracks[] }`, a shape Rust never emits; `PlaybackControls.tsx:48` contains Rust syntax (`chords.len`) and the comment "// Wait, chords is an array in JS"; duplicate JSX attr in `ArrangementLanes.tsx:231`. Only dev mode works (Vite skips typecheck). | `npm run build` exit 2 |
| 2 | **MIDI export routes every lane to channel 9** (GM percussion) — bass/pads/arps play as random drum noises in any DAW (`midi.rs:133,145`). The headline export feature produces broken files. | byte-validated export |
| 3 | **WAV export writes pure silence and reports success.** `render_arrangement` is a zeros placeholder (`mixer.rs:90-93`); `ExportControls.tsx` shows ✓. | code + UI test |
| 4 | **Native session history dead**: `list_runs_for_project` / `get_event_decisions` invoked with snake_case keys; Tauri v2 expects camelCase (`SessionSidebar.tsx:38`, `App.tsx:548`, `useProjects.ts:117`). Works in browser only because the mock accepts anything. | code |
| 5 | **AUTO tempo button silently breaks the mix**: `GrooveControls.tsx:68` sends `{audio_data}`; the command requires `{file_path}` (`commands.rs:580`) — fails, clobbers detected BPM to 120. | code |

## Advertised but fake / misleading

- **Explainability partially fabricates**: DecisionCard emits a fixed template, discarding the classifier's real `all_scores`; the early/late timing label is inverted (`explainability.rs:64,76`).
- **FEEL=Halftime is a no-op** (`grid.rs:297`); **SWING slider is a no-op** unless FEEL=Swing (`quantize.rs:130`).
- **Calibration UI is orphaned** — `Calibration.tsx` is never mounted; `use_calibration: false` hardcoded in App.tsx.
- **Theme metadata three-way contradiction**: README says Stranger Things = E minor (Em→C→G→D); Rust says C minor (Cm→Bb→Ab→Bb); UI shows Blade Runner as "C minor" while Rust says D minor.
- **README claims "121+ unit tests"** — actual 104. Four of eight integration tests depend on `test-pattern.wav`, which `generate-test-audio.mjs` does not generate and which is gitignored — the suite is not reproducible from a fresh clone.

## Other confirmed defects worth fixing

- 8-bit WAV samples offset-corrected twice → garbage waveform (`ingest.rs:88`); 8kHz audio produces ghost onsets with all-zero features at 66% confidence (reproduced live).
- Path traversal: unsanitized IPC filename in `store_file` (`storage.rs:67`); CSP is `null` (`tauri.conf.json`).
- DB row-mapper `unwrap()`s can poison the connection Mutex permanently (`queries.rs:58`).
- Recorder: no unmount cleanup (mic stays open); 30s auto-stop never fires due to stale closure (`useAudioRecorder.ts:44,54`).
- `create_project` stores the WAV under a throwaway UUID — orphaned dirs (`commands.rs:59`).
- `pipelineResult.duration_ms` never populated → waveform/markers assume 10s for every clip (`App.tsx:873`).
- Saved-session reload drops arrangement + real durations (lossy round-trip); replay reads `original_timestamp_ms`, a field that doesn't exist (`App.tsx:556`).
- Visualizer re-applies 4× song expansion on the already-expanded arrangement (`ArrangementLanes.tsx:33`).
- Command errors surface as `[object Object]` (CommandError not an Error instance).
- Non-deterministic "seeded" humanize (RandomState defeats the seed, `quantize.rs:228`).
- ArpPattern::Alternating emits duplicates and skips notes (`types.rs:218-230`); i8 octave-transpose can overflow (`types.rs:200`).
- Hi-hat Eighth density check assumes a sixteenth grid — wrong on eighth grids (`drum_lanes.rs:495`).
- ~28 dead-code warnings; the whole `render/` synth/effects module is scaffolding.

## Process observations

No CI. A broken `tsc` build on master plus Rust-syntax-in-TypeScript indicates code landed without typecheck or review gates. The browser mock accepts any command shape, which is how three native-only IPC breaks stayed invisible — the demo mode actively masks native regressions.

## Recommended fix order

1. CI: `tsc && cargo test && cargo clippy` on every push; fix the 31 TS errors by generating TS types from Rust (ts-rs or specta) — kills the whole contract-drift class.
2. Fix MIDI channels (melodic lanes → channels 0-3) and overlapping note-off pairing; add a golden-file MIDI round-trip test.
3. Fix the two IPC arg-name bugs (camelCase) and make the mock schema-strict so drift fails loudly in dev.
4. Anchor the grid to the estimated beat phase; add octave correction to tempo selection.
5. Replace template hard-gating with "move to nearest allowed slot" (or a fidelity slider: follow-me ↔ genre-template).
6. Either implement WAV render (or record the WebAudio output) or remove the button; same decision for Calibration, Halftime, Swing.
7. Honest README: 104 tests, real theme keys, commit test fixtures.
