# Phase 1: Make Everything Advertised True — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every advertised Beatrice feature works or is removed — fix the broken build, MIDI export, WAV export, native IPC, and dishonest UI, with CI to keep it that way.

**Architecture:** Adopt `tauri-specta` to generate typed TS command bindings from the Rust commands (killing both struct-shape and arg-casing drift at the root). Extract a pure `scheduleArrangement()` from the playback hook so WAV export renders through `OfflineAudioContext`. Delete the silent Rust `render/` module. Add GitHub Actions CI gating tsc, vite build, cargo test, clippy, and binding freshness.

**Tech Stack:** Rust (Tauri 2.9, specta 2.0.0-rc.25, tauri-specta 2.0.0-rc.25, specta-typescript 0.0.12, midly 0.5), TypeScript 5.9, Vite 7, @playwright/test, GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-beatrice-v2-design.md` §3 (Phase 1).
- Rust edition 2021, rust-version 1.77.2 floor (Cargo.toml).
- All IPC types must derive `specta::Type`; `src/bindings.ts` is generated — never hand-edited.
- `docs/` is gitignored; plans/specs are committed with `git add -f` (existing repo practice).
- Working commands to verify nothing regresses: `cd src-tauri && cargo test` (112 tests green today), `npm run dev` + TRY DEMO in browser.
- MIDI channel map (spec §3.2): BASS=0, PADS=1, ARP=2, other melodic=3, DRUMS_*=9.
- No new UI features in this phase — only fixes, removals, and honesty.

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/commands.rs` (modify) | `#[specta::specta]` on all commands; create_project id fix |
| `src-tauri/src/lib.rs` (modify) | tauri-specta builder; export test |
| `src/bindings.ts` (generated) | The only IPC entry point for the frontend |
| `src/types/ipc.ts` (create) | Re-exports of generated types + `formatIpcError` helper |
| `src/audio/scheduleArrangement.ts` (create) | Pure synth scheduling on any `BaseAudioContext` (moved from useAudioPlayback) |
| `src/audio/renderWav.ts` (create) | OfflineAudioContext render + 16-bit WAV encode |
| `src-tauri/src/arranger/midi.rs` (modify) | Channel routing + overlap trimming |
| `src-tauri/src/state/queries.rs` (modify) | No-unwrap row mappers; create_project takes id |
| `src-tauri/src/state/storage.rs` (modify) | Filename sanitization |
| `.github/workflows/ci.yml` (create) | CI pipeline |
| `e2e/smoke.spec.ts` (create) | Playwright demo-path smoke |

---

### Task 0: Toolchain spike — prove tauri-specta's API shape + test scaffolding

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs` (ONE command only)
- Create: `vitest.config.ts`
- Modify: `package.json` (devDeps + scripts)

**Interfaces:**
- Produces: the **verified, committed** generated-binding shape for one command (`greet`). Every later example in this plan that shows `commands.*` / `unwrap` is *provisional* — Task 1/2 implementers MUST follow the shape this spike commits, not the plan's guesses. If rc.25's actual return convention is a plain resolved value + rejected promise (Tauri-native) rather than `{status:"ok"|"error"}`, delete the `unwrap` helper from Task 2 and use try/catch with `formatIpcError` instead.
- Produces: working `npx vitest run` (empty suite passes) so every later task can add frontend tests without tooling detours.

- [ ] **Step 1: Minimal specta wiring for ONE command**

Add the three deps from Task 1 Step 1 to Cargo.toml. Annotate only `greet` with `#[specta::specta]`. Add the `specta_builder()` fn and `export_bindings` test from Task 1 Steps 3–4, with `collect_commands![commands::greet]` only. If the builder/export API differs in rc.25 (e.g. `Builder::new()` vs `ts::builder()`, export method name/signature), adapt HERE and update Task 1's code blocks to match before proceeding.

Run: `cd src-tauri && cargo test export_bindings && head -50 ../src/bindings.ts`

- [ ] **Step 2: Record the ground truth**

Read the generated `bindings.ts`: (a) exact `commands.greet` signature and return shape; (b) how a `Result<T, CommandError>` command will serialize (add `#[specta::specta]` to `list_projects` too and regenerate to see a Result-typed example); (c) argument casing of a multi-word arg. Paste the observed shapes into a comment block at the top of Task 2 in this plan file, replacing its assumptions if they differ. **The browser mock must mirror the native convention exactly** — if native rejects the promise on Err, the mock must `throw`, not return a result object.

- [ ] **Step 3: Frontend test scaffolding**

```bash
npm i -D vitest happy-dom @testing-library/react node-web-audio-api @playwright/test
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "happy-dom" } });
```

Add scripts `"test": "vitest run"` to package.json. Run: `npx vitest run` — Expected: "no test files found" exit 0 (or a trivial placeholder test passes).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/ src/bindings.ts vitest.config.ts package.json package-lock.json
git commit -m "spike: prove tauri-specta binding shape on one command; frontend test scaffolding"
```

---

<!--
========================= OBSERVED GROUND TRUTH (Task 0) =========================
The Task 0 spike proved the assumed rc.25 versions DO NOT WORK on this toolchain:
  - specta rc.24/rc.25 (edition 2024) use the still-unstable `std::fmt::from_fn`
    (`debug_closure_helpers`, rust-lang #117729). They will not compile on the
    Rust 1.77.2 floor NOR on the installed 1.91.1 stable (no rustup/nightly).
  - tauri 2.9.5's own `specta` feature emits `#[specta(rename=...)]` on a
    container, which specta rc.25 rejects ("no longer supported on containers").
VERIFIED WORKING COMBO (compiles on stable 1.91.1, full cargo test green):
    tauri        = { version = "2.9", features = ["specta"] }   # feature REQUIRED
    specta          = { version = "=2.0.0-rc.22", features = ["derive","uuid","chrono"] }
    tauri-specta    = { version = "=2.0.0-rc.21", features = ["derive","typescript"] }
    specta-typescript = "=0.0.9"
  (rc.23 is the highest specta that still compiles on stable; tauri-specta rc.21
   pins specta rc.22, so rc.22 is used.)

EXPORT API in rc.21: `Builder::<tauri::Wry>::new().commands(collect_commands![...])`
then `.export(specta_typescript::Typescript::default()....., "../src/bindings.ts")`
— matches the plan's shape. TWO required tweaks vs the plan's Step 4 snippet:
  (1) `i64`/`u64` fields (e.g. duration_ms) trip `BigIntForbidden`. Add
      `.bigint(specta_typescript::BigIntExportBehavior::Number)` to the exporter.
  (2) tauri's `specta` cargo feature MUST be enabled or `Builder` won't compile.

RETURN CONVENTION — result object, NOT native resolve/reject:
  - Plain-Ok command (`greet`):
        async greet(name: string) : Promise<string>
        // → return await TAURI_INVOKE("greet", { name });   (no wrapper for non-Result cmds)
  - Result command (`list_projects` → CommandResult<Vec<ProjectSummary>>):
        async listProjects() : Promise<Result<ProjectSummary[], CommandError>>
    where  export type Result<T,E> = { status:"ok"; data:T } | { status:"error"; error:E };
    The generated body try/catches TAURI_INVOKE and returns {status:"ok",data} or
    {status:"error",error}. ⇒ Task 2 KEEPS the `unwrap` helper (do NOT switch to
    try/catch). The browser mock MUST return the same {status} objects (never throw
    for a normal Err; only throw for contract-drift/unknown-command).
  NOTE: only Result-returning commands are wrapped. Bare-value commands like
  `greet` resolve the plain value, so `unwrap()` is applied ONLY to Result cmds.

ARG CASING (confirmed via throwaway probe cmd `spike_probe(project_id)`):
        async spikeProbe(projectId: string) : Promise<...>
        // → TAURI_INVOKE("spike_probe", { projectId })
  Multi-word args are camelCased in BOTH the TS param name and the invoke payload
  key; the command NAME stays snake_case. So the mock's required-key checks must
  use camelCase (`projectId`, `runId`), while the invoke string is snake_case.
==================================================================================
-->

### Task 1: tauri-specta — Rust side (derives, builder, binding export)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands.rs` (all 31 commands + input/output structs)
- Modify: `src-tauri/src/lib.rs`
- Modify: every struct crossing IPC: `src-tauri/src/arranger/drum_lanes.rs` (Arrangement, DrumLane, ArrangedNote), `src-tauri/src/arranger/templates.rs` (ArrangementTemplate, enums), `src-tauri/src/events/types.rs` (Event, EventClass, EventFeatures), `src-tauri/src/events/explainability.rs` (EventDecision, AssignedNote), `src-tauri/src/groove/tempo.rs` (TempoEstimate), `src-tauri/src/groove/quantize.rs` (QuantizedEvent), `src-tauri/src/groove/grid.rs` (GridPosition), `src-tauri/src/state/models.rs` (Project, ProjectSummary, Run, RunStatus, RunWithArtifacts, Artifact, ArtifactKind, CalibrationProfile), `src-tauri/src/themes/types.rs` (Theme, ChordProgression, ChordType, ScaleFamily, and the pattern/palette/fx enums)

**Interfaces:**
- Produces: `src/bindings.ts` with a `commands` object — e.g. `commands.listRunsForProject(projectId: string): Promise<Result<Run[], CommandError>>`, `commands.detectEvents(input: DetectEventsInput)`, plus exported types (`Arrangement`, `QuantizedEvent`, `EventDecision`, …). Top-level Rust args are automatically camelCased in the invoke payload — this is the arg-casing root fix.
- Produces: `export_bindings` Rust test that later tasks and CI run to regenerate.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
# Task 0 spike verified these versions; rc.25 does NOT compile (see ground-truth
# block above). Also flip tauri to `features = ["specta"]`.
tauri = { version = "2.9", features = ["specta"] }
specta = { version = "=2.0.0-rc.22", features = ["derive", "uuid", "chrono"] }
tauri-specta = { version = "=2.0.0-rc.21", features = ["derive", "typescript"] }
specta-typescript = "=0.0.9"
```

Run: `cd src-tauri && cargo build 2>&1 | tail -3` — Expected: compiles (deps resolve).

- [ ] **Step 2: Derive `specta::Type` on every IPC struct/enum**

For each type listed in **Files** above, extend the derive list, e.g. in `drum_lanes.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Arrangement { /* unchanged fields */ }
```

Same pattern for all input structs in `commands.rs` (`CreateProjectInput`, `DetectEventsInput`, `EstimateTempoInput`, `QuantizeEventsInput`, `ArrangeEventsInput`, `ExportMidiInput`, `SaveEventDecisionsInput`, `RenderPreviewInput`, …) and `CommandError`:

```rust
#[derive(Debug, Serialize, specta::Type)]
pub struct CommandError { message: String }
```

Note: `uuid::Uuid` and `chrono::DateTime<Utc>` fields are covered by the `uuid`/`chrono` specta features. If a field type resists `Type` (e.g. `MixerSettings` in `RenderPreviewInput`), that command is being deleted in Task 4 — skip it there rather than fighting it.

- [ ] **Step 3: Annotate all commands and build the specta router**

Every `#[tauri::command]` gains `#[specta::specta]` directly beneath it:

```rust
#[tauri::command]
#[specta::specta]
pub fn list_runs_for_project(db: State<'_, DbConnection>, project_id: String) -> CommandResult<Vec<Run>> { ... }
```

In `lib.rs`, replace the `tauri::generate_handler![...]` block:

```rust
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        commands::greet, commands::create_project, commands::get_project,
        commands::list_projects, commands::create_run, commands::get_run,
        commands::list_runs_for_project, commands::get_run_with_artifacts,
        commands::update_run_status, commands::create_artifact,
        commands::list_calibration_profiles, commands::create_calibration_profile,
        commands::get_calibration_profile, commands::update_calibration_profile,
        commands::delete_calibration_profile, commands::detect_onsets,
        commands::detect_events, commands::extract_features, commands::estimate_tempo,
        commands::quantize_events_command, commands::arrange_events_command,
        commands::export_midi_command, commands::list_themes, commands::get_theme,
        commands::list_theme_names, commands::render_preview,
        commands::start_recording, commands::stop_recording, commands::is_recording,
        commands::get_recording_level, commands::save_event_decisions,
        commands::get_event_decisions,
    ])
}

pub fn run() {
    let builder = specta_builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| { builder.mount_events(app); /* existing setup body unchanged */ ... })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Add the export test (this IS the generator)**

At the bottom of `lib.rs`:

```rust
#[cfg(test)]
mod bindings_test {
    use specta_typescript::BigIntExportBehavior;

    #[test]
    fn export_bindings() {
        super::specta_builder()
            .export(
                specta_typescript::Typescript::default()
                    // REQUIRED: i64/u64 fields (duration_ms, …) otherwise trip
                    // BigIntForbidden. ms magnitudes are JS-safe integers.
                    .bigint(BigIntExportBehavior::Number)
                    .header("// @ts-nocheck — generated by tauri-specta; do not edit\n"),
                "../src/bindings.ts",
            )
            .expect("failed to export bindings");
    }
}
```

Run: `cd src-tauri && cargo test export_bindings` — Expected: PASS, `src/bindings.ts` created with a `commands` object and all types.

- [ ] **Step 5: Verify full suite still green and commit**

Run: `cd src-tauri && cargo test` — Expected: 112+ pass (may emit new warnings; clippy comes in Task 8).

```bash
git add src-tauri/ src/bindings.ts
git commit -m "feat: generate typed IPC bindings with tauri-specta"
```

---

<!--
===================== OBSERVED GROUND TRUTH (Task 0) — READ FIRST =====================
Confirmed by generating `src/bindings.ts` for `greet` + `list_projects` (spike commit).

VERBATIM generated signatures:
    async greet(name: string) : Promise<string>
        // body: return await TAURI_INVOKE("greet", { name });
    async listProjects() : Promise<Result<ProjectSummary[], CommandError>>
        // body try/catch: {status:"ok",data:await TAURI_INVOKE("list_projects")}
        //             or  {status:"error",error:e}
    export type Result<T,E> = { status:"ok"; data:T } | { status:"error"; error:E };
    export type CommandError = { message: string };
    export type ProjectSummary = { id: string; name: string; created_at: string;
                                   duration_ms: number; run_count: number };

RETURN CONVENTION = **result object** ({status:"ok"|"error"}), NOT native reject.
  ⇒ KEEP the `unwrap` helper below (do NOT delete it / do NOT switch to try/catch).
  ⇒ ONLY Result<…>-returning commands are wrapped; bare-value commands (e.g. `greet`)
    resolve the plain value — call those WITHOUT `unwrap`.
  ⇒ The browser mock MUST mirror this: return {status:"ok",data} for success and
    {status:"error",error:{message}} for a normal backend error — throw ONLY for
    contract drift (missing key) or unknown command, matching TAURI_INVOKE rejects.

ARG CASING: multi-word Rust args are camelCased in BOTH the TS param and the invoke
  payload key (probe: `project_id` → `projectId`, invoked as
  TAURI_INVOKE("list_runs_for_project", { projectId })). Command NAME stays snake_case.
  ⇒ mock `requireKeys` must check camelCase keys (`projectId`, `runId`, …).

Type notes: `Uuid` → `string`; `DateTime<Utc>` → `string`; `i64`/`u64` → `number`
  (exporter configured with BigIntExportBehavior::Number).
======================================================================================
-->

### Task 2: Frontend migration to generated bindings (fixes the 31 TS errors)

**Files:**
- Create: `src/types/ipc.ts`
- Modify (EXHAUSTIVE — every file importing `@tauri-apps/api/core` except the mock itself): `src/App.tsx`, `src/components/PlaybackControls.tsx`, `src/components/Explainability/ArrangementLanes.tsx`, `src/components/Explainability/Timeline.tsx`, `src/components/Waveform.tsx`, `src/components/BeatMarkers.tsx`, `src/components/SessionSidebar.tsx`, `src/hooks/useProjects.ts`, `src/hooks/useAudioRecorder.ts`, `src/components/Groove/GrooveControls.tsx`, `src/components/ExportControls.tsx`, `src/components/DemoButton.tsx` (create_project at :32), `src/components/AudioInput/DropZone.tsx` (create_project at :50), `src/components/AudioInput/Recorder.tsx`, `src/components/AudioInput/Calibration.tsx` (unmounted, but migrate or delete — Task 7 hides it anyway), `src/components/Theme/ThemeSelector.tsx` (list_themes/get_theme at :52)
- Modify: `src/utils/tauri-mock.ts` (arg casing + schema-strict)
- Guard: add to `e2e/`-adjacent tooling a ban on new direct imports — `package.json` script `"lint:ipc": "! grep -rln --include='*.ts' --include='*.tsx' '@tauri-apps/api/core' src | grep -v -e '^src/bindings.ts$' -e '^src/utils/tauri-mock.ts$'"`, wired into `npm run check` and CI (Task 8)
- Delete: hand-written `interface Arrangement` in `App.tsx:64` and `ArrangementLanes.tsx:16`; local `EventDecision`-shape drift in `src/types/explainability.ts` (keep display maps, re-export generated types)

**Interfaces:**
- Consumes: `src/bindings.ts` from Task 1.
- Produces: `src/types/ipc.ts`:

```ts
export * from "../bindings";                       // generated types + commands
export function formatIpcError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err)
    return String((err as { message: unknown }).message);
  return "Unknown error";
}
```
- Produces (consumed by Tasks 4, 6 and Phase 2): `PipelineResult` in App.tsx now `{ events: Event[]; quantized_events: QuantizedEvent[]; arrangement: Arrangement; tempo: TempoEstimate; duration_ms: number }` — `tempo` replaces the bare `bpm` field; `duration_ms` populated from `project.duration_ms`.

- [ ] **Step 1: Establish the failing baseline**

Run: `npx tsc --noEmit; echo "exit: $?"` — Expected: 31 errors, exit 2 (documented in evaluation). This is the "test" this task turns green.

- [ ] **Step 2: Migrate all `invoke<...>()` calls to `commands.*`**

Replace every `invoke<T>("cmd", {...})` in the files above with the generated call. Key rewrites:

```ts
// SessionSidebar.tsx:38 and useProjects.ts:117 (the camelCase bug sites)
const runs = unwrap(await commands.listRunsForProject(projectId));

// App.tsx:548
const decisions = unwrap(await commands.getEventDecisions(run.id));

// App.tsx replay (line ~556): EventDecision has timestamp_ms, NOT original_timestamp_ms
timestamp_ms: d.timestamp_ms,
```

**Return convention: use whatever Task 0 committed.** If rc.25 emits `{status:"ok"|"error"}` results, add the `unwrap` helper below to `src/types/ipc.ts`; if it emits Tauri-native resolve/reject, skip `unwrap` entirely and wrap call sites in try/catch with `formatIpcError`. All `unwrap(...)` snippets in this plan then read as plain `await commands.x(...)`.

```ts
export function unwrap<T, E>(r: { status: "ok"; data: T } | { status: "error"; error: E }): T {
  if (r.status === "error") throw r.error;
  return r.data;
}
```

- [ ] **Step 3: Fix the non-IPC TS errors**

- `PlaybackControls.tsx:41-57`: delete the Rust-pseudocode chord block (`chords.len`, hardcoded names). Replace with:

```ts
const CHORD_LABELS: Record<string, (root: number) => string> = {
  Im:  (r) => NOTE_NAMES[r % 12] + "m",
  III: (r) => NOTE_NAMES[(r + 3) % 12],
  VI:  (r) => NOTE_NAMES[(r + 8) % 12],
  VII: (r) => NOTE_NAMES[(r + 10) % 12],
  IV:  (r) => NOTE_NAMES[(r + 5) % 12] + "m",
  V:   (r) => NOTE_NAMES[(r + 7) % 12] + "m",
};
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
// bar → chord index: theme.chord_progression.chords[Math.floor(bar / theme.chord_progression.bars_per_chord) % theme.chord_progression.chords.length]
```

- `ArrangementLanes.tsx`: delete local `Arrangement` interface (use generated); **remove the ×4 `loopCount` re-expansion** (`loopCount = 4`, `totalSongDurationMs = loopDurationMs * loopCount`) — the backend already returns the expanded song; use `arrangement.total_duration_ms` directly. Fix the duplicate JSX attribute at line 231 (merge the two `animate` props into one object). Remove unused `themeName` prop.
- `Timeline.tsx` / `Waveform.tsx` / `BeatMarkers.tsx`: the `quantized_timestamp_ms`/`snap_delta_ms` possibly-undefined errors — where App.tsx assembles the timeline decisions, default them (`quantized_timestamp_ms: q?.quantized_timestamp_ms ?? ev.timestamp_ms`, `snap_delta_ms: q?.snap_delta_ms ?? 0`) so component props are non-optional.
- Error surfacing (spec §3.4): App.tsx already has an `error` state + banner for pipeline failures; route the debounced re-arrange effect's catch (currently `console.error` only, App.tsx:416) through `setError(formatIpcError(err))` so every IPC failure is visible, never `[object Object]`.
- Saved-run replay (App.tsx ~581): stop faking `arrangement: { tracks: [] }`. After reconstructing events, rebuild honestly:

```ts
const quantized = unwrap(await commands.quantizeEventsCommand({ input: { events, bpm: run.bpm, /* grid settings from run */ ... } }));
const arrangement = unwrap(await commands.arrangeEventsCommand({ input: { events: quantized, theme_name: run.theme, bpm: run.bpm, ... } }));
```

- Populate `duration_ms: _project.duration_ms` and `tempo: tempoResult` in `setPipelineResult` (both call sites), and change `Waveform`/`BeatMarkers` duration prop from the hardcoded `10000` (App.tsx:873) to `pipelineResult.duration_ms`.

- [ ] **Step 4: Make the mock schema-strict and camelCase-correct**

In `tauri-mock.ts`, replace the permissive `switch` fallthrough with a registry:

```ts
const HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_runs_for_project: (a) => { requireKeys(a, ["projectId"]); return []; },
  get_event_decisions:   (a) => { requireKeys(a, ["runId"]); return []; },
  // ... every command the UI invokes, with its exact required keys ...
};
function requireKeys(args: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (!(k in args))
    throw new Error(`[Tauri Mock] '${k}' missing — frontend/backend contract drift`);
}
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const h = HANDLERS[cmd];
  if (!h) throw new Error(`[Tauri Mock] Unknown command '${cmd}'`);
  return h(args) as T;
}
```

Mock return/throw convention MUST mirror what Task 0 observed for native (result-shaped values vs promise rejection) — divergence here is exactly the bug class that hid the camelCase breaks.

- [ ] **Step 5: Verify build passes, demo works, commit**

Run: `npx tsc --noEmit && npm run build` — Expected: exit 0, zero errors.
Run: `npm run dev` → open http://localhost:1420 → TRY DEMO → PLAY. Expected: pipeline completes, playback audible, no console errors.

```bash
git add src/
git commit -m "fix: migrate frontend to generated bindings; repair 31 TS errors and replay flow"
```

---

### Task 3: MIDI export — channel routing + overlap trimming + golden-file test

**Files:**
- Modify: `src-tauri/src/arranger/midi.rs` (`create_lane_track` ~line 109; new `channel_for_lane`, `trim_overlaps`)
- Test: same file `#[cfg(test)]` module

**Interfaces:**
- Consumes: `DrumLane { name: String, midi_note: u8, events: Vec<ArrangedNote> }`, `ArrangedNote { timestamp_ms: f64, duration_ms: f64, velocity: u8, midi_note: Option<u8>, .. }`.
- Produces: unchanged `export_midi(&Arrangement, &Grid, &MidiExportOptions) -> Result<Vec<u8>, String>` — bytes now DAW-correct.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn melodic_lanes_use_melodic_channels() {
    let arr = two_lane_arrangement(); // helper: DRUMS_KICK note + BASS note (build like existing tests in this module)
    let bytes = export_midi(&arr, &test_grid(), &MidiExportOptions::default()).unwrap();
    let smf = midly::Smf::parse(&bytes).unwrap();
    let channels: Vec<(String, u8)> = collect_note_on_channels(&smf); // (track_name, channel) per NoteOn
    assert!(channels.iter().any(|(n, c)| n == "DRUMS_KICK" && *c == 9));
    assert!(channels.iter().any(|(n, c)| n == "BASS" && *c == 0));
}

#[test]
fn overlapping_same_pitch_notes_are_trimmed() {
    let mut lane = DrumLane::new("PADS", 48);
    lane.add_note(ArrangedNote::new(0.0, 1000.0, 80, Some(60), None));
    lane.add_note(ArrangedNote::new(500.0, 1000.0, 80, Some(60), None)); // overlaps prev
    let trimmed = trim_overlaps(&lane.events);
    assert!((trimmed[0].duration_ms - 500.0).abs() < 1e-6); // first note cut at second's onset
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test midi -- --nocapture` — Expected: FAIL (`channel_for_lane`/`trim_overlaps` undefined; channel assert fails).

- [ ] **Step 3: Implement**

```rust
fn channel_for_lane(name: &str) -> u8 {
    match name {
        n if n.to_uppercase().starts_with("DRUMS") => 9,
        "BASS" => 0,
        "PADS" => 1,
        "ARP" => 2,
        _ => 3,
    }
}

/// Sorted-by-time input; if two notes share a pitch and overlap, trim the first to end at the second's onset.
fn trim_overlaps(events: &[ArrangedNote]) -> Vec<ArrangedNote> {
    let mut out: Vec<ArrangedNote> = events.to_vec();
    out.sort_by(|a, b| a.timestamp_ms.partial_cmp(&b.timestamp_ms).unwrap());
    for i in 0..out.len() {
        let (pitch_i, on_i, off_i) = (out[i].midi_note, out[i].timestamp_ms, out[i].timestamp_ms + out[i].duration_ms);
        for j in (i + 1)..out.len() {
            if out[j].timestamp_ms >= off_i { break; }
            if out[j].midi_note == pitch_i && out[j].timestamp_ms > on_i {
                out[i].duration_ms = out[j].timestamp_ms - on_i;
                break;
            }
        }
    }
    out
}
```

In `create_lane_track`: `let channel = channel_for_lane(&lane.name);` replace both hard-coded `9.into()` with `channel.into()`, and iterate `trim_overlaps(&lane.events)` instead of `&lane.events`.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test midi` — Expected: PASS, all pre-existing midi tests too.

- [ ] **Step 5: Manual DAW verification + commit**

Run: `cd src-tauri && cargo run --bin analyze -- ../test-audio/real-beatbox-2.wav` (unchanged smoke), then open a fresh exported .mid (via the app or a small `cargo test` writing `/tmp/beatrice-check.mid`) in GarageBand/Ableton: bass plays as a pitched instrument, drums as drums.

```bash
git add src-tauri/src/arranger/midi.rs
git commit -m "fix: route melodic MIDI lanes off the percussion channel; trim same-pitch overlaps"
```

---

### Task 4: Real WAV export via OfflineAudioContext (delete the silent renderer)

**Files:**
- Create: `src/audio/scheduleArrangement.ts` (move `velocityToGain`, `midiToFreq`, `createNoiseBuffer`, `createImpulseResponse`, master-bus construction, `scheduleSidechainDuck`, `scheduleKick/Snare/Hihat/Bass/Pad/Note`, `calculateArrangementDuration` from `src/hooks/useAudioPlayback.ts:34-496`)
- Create: `src/audio/renderWav.ts`
- Modify: `src/hooks/useAudioPlayback.ts` (consume the new module; keep only hook state/lifecycle)
- Modify: `src/components/ExportControls.tsx` (WAV path → frontend render; duration from arrangement; browser Blob fallback)
- Delete: `src-tauri/src/render/` (mod.rs, synth.rs, effects.rs, mixer.rs), `render_preview` command + `RenderPreviewInput` in commands.rs, its lib.rs registration, `samples_to_wav` helper
- Test: `src/audio/renderWav.test.ts` (Vitest — added here; config in Task 8)

**Interfaces:**
- Produces:

```ts
// scheduleArrangement.ts — every function takes ctx/destination explicitly; NO module-global nodes
export interface FxBus { input: GainNode; }  // master in; internally wires delay/reverb/dry to `destination`
export function createFxBus(ctx: BaseAudioContext, destination: AudioNode): FxBus;
export function scheduleArrangement(ctx: BaseAudioContext, bus: FxBus, arrangement: Arrangement, startTime: number): number; // returns total duration (s)
export { scheduleKick, scheduleSnare, scheduleHihat, scheduleBass, schedulePad }; // (ctx, bus, time, velocity, [freq]) — reused by Phase 3 jam mode

// renderWav.ts
export async function renderArrangementToWav(arrangement: Arrangement, sampleRate?: number): Promise<Uint8Array>; // 16-bit stereo PCM WAV
```
- Consumes: generated `Arrangement` type (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// src/audio/renderWav.test.ts
import { describe, it, expect } from "vitest";
import { renderArrangementToWav } from "./renderWav";

const arr = {
  drum_lanes: [{ name: "DRUMS_KICK", midi_note: 36,
    events: [{ timestamp_ms: 0, duration_ms: 200, velocity: 120, midi_note: 36, source_event_id: null }] }],
  bass_lane: null, pad_lane: null, arp_lane: null,
  template: "synthwave_straight", total_duration_ms: 1000, bar_count: 1,
} as any;

describe("renderArrangementToWav", () => {
  it("produces a non-silent RIFF/WAVE file of the right length", async () => {
    const wav = await renderArrangementToWav(arr, 44100);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    const data = new Int16Array(wav.buffer, 44);
    expect(data.length).toBe(44100 * 2 /*stereo*/ * 1 /*sec*/);
    const peak = Math.max(...Array.from(data.slice(0, 44100)).map(Math.abs));
    expect(peak).toBeGreaterThan(1000); // kick at t=0 is audible, not silence
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/audio/renderWav.test.ts` — Expected: FAIL (module not found). Tooling was installed in Task 0; this test runs under `// @vitest-environment node` with `globalThis.OfflineAudioContext ??= (await import("node-web-audio-api")).OfflineAudioContext` in a test-setup preamble (happy-dom has no audio graph). **Fallback if node-web-audio-api's OfflineAudioContext proves unfaithful or unavailable on this platform:** demote this to a structural test (RIFF/WAVE headers + length from a stub scheduler) and move the non-silence assertion into a Playwright test that runs the real browser render and inspects the decoded buffer via `page.evaluate` — the Playwright infra exists by Task 8.

- [ ] **Step 3: Implement the extraction and renderer**

`scheduleArrangement.ts`: move the functions verbatim from `useAudioPlayback.ts:34-496` with two mechanical changes: (a) every `ctx: AudioContext` becomes `ctx: BaseAudioContext`; (b) delete the module-globals `masterGain/reverbNode/delayNode/delayFeedback` (lines 59-62) and `getMasterBus`'s memoization — `createFxBus(ctx, destination)` builds the same graph fresh, connecting to `destination` instead of `ctx.destination`, and returns `{ input: masterGain }`. `scheduleSidechainDuck(bus, time)` takes the bus. `scheduleArrangement` is the loop currently inline in `play()` (useAudioPlayback.ts:577+): iterate `drum_lanes`/`bass_lane`/`pad_lane`/`arp_lane`, dispatch per lane name to the schedule* functions at `startTime + timestamp_ms/1000`.

`renderWav.ts`:

```ts
import { createFxBus, scheduleArrangement } from "./scheduleArrangement";
import type { Arrangement } from "../types/ipc";

export async function renderArrangementToWav(arrangement: Arrangement, sampleRate = 44100): Promise<Uint8Array> {
  const durationSec = arrangement.total_duration_ms / 1000;
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  scheduleArrangement(ctx, createFxBus(ctx, ctx.destination), arrangement, 0);
  const buf = await ctx.startRendering();
  return encodeWav16(buf);
}

function encodeWav16(buf: AudioBuffer): Uint8Array {
  const ch = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
  const frames = buf.length, out = new DataView(new ArrayBuffer(44 + frames * 4));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); out.setUint32(4, 36 + frames * 4, true); w(8, "WAVE");
  w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 4, true);
  out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, frames * 4, true);
  for (let i = 0, o = 44; i < frames; i++, o += 4) {
    out.setInt16(o, Math.max(-1, Math.min(1, ch[0][i])) * 0x7fff, true);
    out.setInt16(o + 2, Math.max(-1, Math.min(1, ch[1][i])) * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}
```

`useAudioPlayback.ts`: `play()` now calls `createFxBus(ctx, ctx.destination)` + `scheduleArrangement(...)`; the hook keeps only AudioContext lifecycle, RAF tick, stop/cleanup.

`ExportControls.tsx` `handleExportWav`: replace the `render_preview` invoke with `const wavBytes = await renderArrangementToWav(arrangement);`; delete the `bar_count*4*60/bpm` duration line (`:97`); save via Tauri dialog when `isTauriAvailable()`, else Blob download:

```ts
const blob = new Blob([wavBytes], { type: "audio/wav" });
const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `beatrice_${themeName}.wav` });
a.click(); URL.revokeObjectURL(a.href);
```

Rust deletions: remove `mod render;` from lib.rs, delete `src-tauri/src/render/`, delete `render_preview`/`RenderPreviewInput`/`samples_to_wav` from commands.rs and both registration lists (lib.rs specta_builder — regenerate bindings after: `cargo test export_bindings`).

- [ ] **Step 4: Run all verification**

Run: `npx vitest run src/audio/renderWav.test.ts` — Expected: PASS.
Run: `cd src-tauri && cargo test` — Expected: PASS (render tests removed with module).
Run: `npx tsc --noEmit` — Expected: 0 errors.
Manual: `npm run dev` → TRY DEMO → PLAY sounds identical to before the refactor → EXPORT WAV downloads a file; play it — audible kick/bass, correct length.

- [ ] **Step 5: Commit**

```bash
git add src/ src-tauri/
git commit -m "feat: real WAV export via OfflineAudioContext; delete silent Rust renderer"
```

---

### Task 5: Persistence + storage correctness (orphaned files, panics, traversal, CSP)

**Files:**
- Modify: `src-tauri/src/state/queries.rs` (row mappers ~lines 58, 90; `create_project` signature)
- Modify: `src-tauri/src/commands.rs` (`create_project` ~line 59)
- Modify: `src-tauri/src/state/storage.rs` (`store_file` ~line 55)
- Modify: `src-tauri/tauri.conf.json` (CSP)
- Test: `#[cfg(test)]` in queries.rs / storage.rs

**Interfaces:**
- Produces: `queries::create_project(db, id: Uuid, name, input_path, input_sha256, duration_ms)` — id now supplied by caller.
- Produces: `storage::StorageError::InvalidFilename(String)` variant.

- [ ] **Step 1: Write failing tests**

```rust
// storage.rs tests
#[test]
fn store_file_rejects_path_traversal() {
    let id = Uuid::new_v4();
    assert!(store_file(&id, None, "../evil.wav", b"x").is_err());
    assert!(store_file(&id, None, "a/b.wav", b"x").is_err());
    assert!(store_file(&id, None, "ok.wav", b"x").is_ok());
}

// queries.rs tests
#[test]
fn create_project_uses_supplied_id() {
    let db = test_db(); // existing helper in this module
    let id = Uuid::new_v4();
    let p = create_project(&db, id, "n".into(), "/p".into(), "sha".into(), 1000).unwrap();
    assert_eq!(p.id, id);
}

#[test]
fn corrupt_uuid_row_is_an_error_not_a_panic() {
    let db = test_db();
    db.lock().execute("INSERT INTO projects (id, created_at, name, input_path, input_sha256, duration_ms) VALUES ('not-a-uuid', '2026-01-01T00:00:00Z', 'x', '/x', 's', 1)", []).unwrap();
    assert!(list_projects(&db).is_err()); // was: panic + Mutex poison
}
```

- [ ] **Step 2: Run to verify failures**

Run: `cd src-tauri && cargo test state::` — Expected: traversal test FAILS (currently succeeds writing outside), supplied-id doesn't compile (signature), corrupt-row PANICS.

- [ ] **Step 3: Implement**

storage.rs:

```rust
fn validated_filename(filename: &str) -> StorageResult<&str> {
    let ok = !filename.is_empty()
        && !filename.contains(['/', '\\'])
        && !filename.contains("..")
        && filename.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok { Ok(filename) } else { Err(StorageError::InvalidFilename(filename.to_string())) }
}
// store_file + store_calibration_profile: let filename = validated_filename(filename)?;
```

queries.rs — helper + mechanical replacement of every `Uuid::parse_str(...).unwrap()` / `.parse().unwrap()` in row mappers (`get_project`, `list_projects`, `get_run`, `list_runs_for_project`, artifact/calibration mappers):

```rust
fn col_uuid(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<Uuid> {
    let s: String = row.get(idx)?;
    Uuid::parse_str(&s).map_err(|e| rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e)))
}
fn col_datetime(row: &rusqlite::Row, idx: usize) -> rusqlite::Result<chrono::DateTime<chrono::Utc>> {
    let s: String = row.get(idx)?;
    s.parse().map_err(|e: chrono::ParseError| rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e)))
}
```

`create_project` gains `id: Uuid` param (drop internal `Uuid::new_v4()`); commands.rs `create_project` moves its existing `let project_id = Uuid::new_v4();` above `store_file` and passes it through — file dir and DB row now share the id.

tauri.conf.json:

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: asset: http://asset.localhost; connect-src 'self' ipc: http://ipc.localhost"
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test` — Expected: all PASS. Then `cargo tauri dev` once: record → results → sidebar History shows the session (validates CSP didn't break IPC and the camelCase fix from Task 2 works natively).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "fix: project-id file orphaning, panic-free row mappers, filename validation, real CSP"
```

---

### Task 6: Recorder lifecycle + tempo-control honesty

**Files:**
- Modify: `src/hooks/useAudioRecorder.ts`
- Modify: `src/components/Groove/GrooveControls.tsx` (delete its `estimate_tempo` invoke, lines ~55-88; halftime removal)
- Modify: `src/App.tsx` (pass tempo down)
- Test: `src/hooks/useAudioRecorder.test.ts`

**Interfaces:**
- Consumes: `PipelineResult.tempo: TempoEstimate` (Task 2).
- Produces: `GrooveControls` props change: `- audioData: Uint8Array` → `+ tempoEstimate: TempoEstimate | null`. AUTO button = `setManualBpm(Math.round(tempoEstimate.bpm)); setUseManualBpm(false)` — no IPC.

- [ ] **Step 1: Write failing recorder tests**

(Test deps installed in Task 0.)

```ts
// src/hooks/useAudioRecorder.test.ts  (@vitest-environment happy-dom)
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
vi.mock("../types/ipc", () => ({ commands: {
  startRecording: vi.fn().mockResolvedValue({ status: "ok", data: null }),
  stopRecording: vi.fn().mockResolvedValue({ status: "ok", data: [82,73,70,70] }),
  getRecordingLevel: vi.fn().mockResolvedValue({ status: "ok", data: 0.5 }),
}, unwrap: (r: any) => r.data, formatIpcError: (e: any) => String(e) }));
import { useAudioRecorder } from "./useAudioRecorder";
import { commands } from "../types/ipc";

describe("useAudioRecorder", () => {
  beforeEach(() => vi.useFakeTimers());
  it("auto-stops at MAX_DURATION", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(() => result.current.startRecording());
    await act(async () => { vi.advanceTimersByTime(30_100); await vi.runOnlyPendingTimersAsync(); });
    expect(commands.stopRecording).toHaveBeenCalled();          // fails today: stale closure sees isRecording=false
  });
  it("cleans up intervals and stops on unmount", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());
    await act(() => result.current.startRecording());
    unmount();
    expect(commands.stopRecording).toHaveBeenCalled();          // fails today: no unmount cleanup
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/hooks/useAudioRecorder.test.ts` — Expected: both FAIL.

- [ ] **Step 3: Implement**

In `useAudioRecorder.ts`: (a) migrate invokes to `commands.*` (Task 2 pattern); (b) fix the stale closure — keep the latest stop in a ref; (c) unmount cleanup:

```ts
const stopRef = useRef<() => Promise<void>>(async () => {});
useEffect(() => { stopRef.current = stopRecording; });           // always latest
// timer body: if (elapsed >= MAX_DURATION) void stopRef.current();
const isRecordingRef = useRef(false);                            // mirror state for cleanup
useEffect(() => () => {                                          // unmount only
  if (timerRef.current) clearInterval(timerRef.current);
  if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);
  if (isRecordingRef.current) void stopRef.current();
}, []);
```

Also drop `state.isRecording` guard at stopRecording top in favor of `isRecordingRef` (removes the `[state.isRecording]` dep — stable callback).

GrooveControls: delete the `estimateTempo`/`useEffect` block (lines ~55-88) and `audioData` prop; render BPM/confidence from `tempoEstimate`; AUTO as specified. FEEL row: remove the `halftime` button (leaves straight/swing); SWING slider: `disabled={feel !== "swing"}` with hint text `enable FEEL: swing`. App.tsx: pass `tempoEstimate={pipelineResult?.tempo ?? null}`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npx tsc --noEmit` — Expected: PASS/0 errors. Manual: dev app → results → AUTO restores detected BPM (no console error, no 120-clobber); swing slider greyed until FEEL=swing.

- [ ] **Step 5: Commit**

```bash
git add src/ package.json package-lock.json
git commit -m "fix: recorder auto-stop and unmount cleanup; honest tempo/feel/swing controls"
```

---

### Task 7: Honesty pass — themes, explainability label, fixtures, README

**Files:**
- Modify: `src/utils/tauri-mock.ts` (theme metadata), `src-tauri/src/events/explainability.rs` (~line 76), `scripts/generate-test-audio.mjs`, `README.md`
- Test: explainability label unit test; `cargo test` fixture run from clean dir

**Interfaces:**
- Consumes: Rust themes as source of truth: BLADE RUNNER root 62 (D minor, Dm–Bb–F–C via i-VI-III-VII), STRANGER THINGS root 60 (C minor, Cm–Bb–Ab–Bb via i-VII-VI-VII).

- [ ] **Step 1: Write the failing label test**

```rust
// explainability.rs tests — snap_delta_ms = quantized - original; positive delta means the hit was EARLY (pulled later)
#[test]
fn timing_label_matches_delta_sign() {
    assert!(timing_description(25.0).contains("early"));   // moved +25ms later ⇒ user was early
    assert!(timing_description(-25.0).contains("late"));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test timing_label` — Expected: FAIL (labels inverted at explainability.rs:76).

- [ ] **Step 3: Implement the fixes**

- explainability.rs: swap the early/late branches (extract the string into `fn timing_description(snap_delta_ms: f64) -> String` if it's inline).
- tauri-mock.ts `list_themes`/`get_theme`: `BLADE RUNNER root_note: 62` ("D minor", 80–120 BPM), `STRANGER THINGS root_note: 60` ("C minor", 100–120 BPM per Rust bpm_range) — and any hardcoded key strings in ThemeSelector.
- `generate-test-audio.mjs`: add `writeWav('test-pattern.wav', generatePattern())` where `generatePattern()` concatenates kick@0ms, hihat@500ms, snare@1000ms, kick@1500ms into a 2.5s 44.1kHz mono buffer using the existing `generateKick/generateHihat/generateSnare` helpers (integration tests expect ≥4 onsets, K/H/C/K classes, ~120 BPM).
- README: test counts (104 unit + 8 integration + new ones), Stranger Things = C minor (Cm→Bb→Ab→Bb), Blade Runner UI key label, note that `test-audio/` is generated (`node scripts/generate-test-audio.mjs`), WAV export now real, MIDI channel behavior, remove "121+" claim.

- [ ] **Step 4: Verify fixture reproducibility + tests**

Run: `rm -rf test-audio && node scripts/generate-test-audio.mjs && cd src-tauri && cargo test` — Expected: all tests PASS from regenerated fixtures (this was impossible before — test-pattern.wav wasn't generated).

- [ ] **Step 5: Commit**

```bash
git add scripts/ src/ src-tauri/ README.md
git commit -m "fix: honest theme metadata, timing labels, reproducible fixtures, README claims"
```

---

### Task 8: CI + clippy zero-warning + Playwright smoke

**Files:**
- Create: `.github/workflows/ci.yml`, `playwright.config.ts`, `e2e/smoke.spec.ts`, `vitest.config.ts`
- Modify: `package.json` (scripts + devDeps `@playwright/test`), assorted Rust files (warning cleanup: unused imports listed by clippy; `pipeline/trace.rs` dead fns get `#[allow(dead_code)]` with a `// used by Phase 2 tracing` note or are deleted)

**Interfaces:**
- Produces: `npm run check` = the reviewer command from spec Goals §2.5.

- [ ] **Step 1: Add remaining scripts** (vitest config + test deps exist since Task 0)

```json
// package.json scripts (adds to Task 0's "test")
"e2e": "playwright test",
"lint:ipc": "! grep -rln --include=*.ts --include=*.tsx '@tauri-apps/api/core' src | grep -v -e '^src/bindings.ts$' -e '^src/utils/tauri-mock.ts$'",
"check": "tsc --noEmit && vite build && npm run lint:ipc && vitest run && npm run check:rust",
"check:rust": "cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
```

- [ ] **Step 2: Drive clippy to zero**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings 2>&1 | grep -c "^warning\|^error"` — fix every hit: delete the ~10 unused imports (drum_lanes.rs:7,10, features.rs:5-6, commands.rs:7, pipeline/*, themes/stranger_things.rs:139), prefix `_sample_rate` (features.rs:394), delete now-unreferenced `state::storage::read_file` and `DbError::InitFailed` if truly dead, keep-or-kill trace.rs helpers. Re-run until exit 0.

- [ ] **Step 3: Write the Playwright smoke**

```ts
// e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";
test("demo path: pipeline → playback UI → no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:1420");
  await page.getByRole("button", { name: /TRY DEMO/ }).click();
  await expect(page.getByRole("button", { name: /PLAY/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/SONG ARRANGEMENT/)).toBeVisible();
  expect(errors).toEqual([]);
});
```

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  webServer: { command: "npm run dev", url: "http://localhost:1420", reuseExistingServer: true },
});
```

Run: `npm i -D @playwright/test && npx playwright install chromium && npm run e2e` — Expected: PASS.

- [ ] **Step 4: CI workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vite build
      - run: npx vitest run
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libasound2-dev
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node scripts/generate-test-audio.mjs
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
      - name: bindings freshness
        run: |
          cargo test --manifest-path src-tauri/Cargo.toml export_bindings
          git diff --exit-code src/bindings.ts
```

- [ ] **Step 5: Full local gate, push, verify, commit**

Run: `npm run check` — Expected: exit 0 end-to-end.

```bash
git add .github/ e2e/ playwright.config.ts vitest.config.ts package.json package-lock.json src-tauri/
git commit -m "ci: gate tsc, vite build, vitest, playwright smoke, cargo test, clippy, binding freshness"
git push  # then confirm the Actions run is green
```

**Phase 1 exit criteria check (spec §3):** CI green from fresh clone ✅ (Task 8) · exported MIDI correct in a DAW ✅ (Task 3) · WAV export audible ✅ (Task 4) · native session history works ✅ (Tasks 2+5) · no no-op UI controls ✅ (Tasks 6+7).
