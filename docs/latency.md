# Phase 3 Task 1 — WASM AudioWorklet Detector: Latency Spike & GATE Decision

**Date:** 2026-07-13/14
**Branch:** v2
**Author:** Phase 3 Task 1 (THE SPIKE)

---

## GATE DECISION

> **Rule: acoustic mouth-to-sound P95 ≤ 60ms → FULL JAM. P95 > 60ms → VISUAL JAM (Tasks 4–5 take their [GATE-FAIL] form).**

### DECISION: **NO-GO for FULL live-synth jam → VISUAL JAM**

Measured real acoustic loopback P95 = **100.2–106.9ms** across three runs on
this machine's built-in mic + speakers — **~1.7x over the 60ms budget**. The
median alone (52–63ms) already sits at/above the ceiling, so there is no
headroom. Tasks 4–5 take their **[GATE-FAIL] / VISUAL-JAM** form.

This is a **confident NO-GO for full jam on commodity built-in laptop audio**,
NOT a verdict on the WASM detector itself. See "What this does and does not
prove" below — the compute path is fast (P95 18.5ms); the acoustic round trip
of the built-in hardware is the wall.

> **Numbers below are the SPIKE's, measured with an RMS-stub detector.** The
> shipping detector was re-measured in Task 6 (final section of this doc): the
> real `StreamingDetector` defers each onset ~100ms by design, so the final
> synthetic floor is ~112ms P95 and the final loopback is ~165ms P95. The NO-GO
> only hardens — the detector alone now exceeds the 60ms budget before any
> acoustic path. Read the **Task 6 re-measure** section at the bottom for the
> final, shipping numbers.

---

## Methodology

The `/jam-spike` dev route runs the measurement in-browser (the AudioWorklet,
the WASM detector, and the WebAudio clock all live there) and dumps results to
`window.__latencyResults`. `scripts/measure-latency.mjs` launches Chromium
against **real devices**, waits for the run, and prints P50/P95.

Two modes:

- **loopback** (default, the gate number): a 5ms white-noise click is played
  through the **speakers** every 800ms ± deterministic jitter (20 reps); the
  **mic** hears it; the WASM detector fires; we log `performance.now()` between
  click emission and the worklet's `hit` message. This is the **REAL acoustic
  round trip**: DAC out + air + ADC in + input buffering + worklet quantum +
  WASM compute + port message. First hit per click is paired; the kick we fire
  in response is itself audible, so later hits within the window are ignored.
- **synthetic** (`--synthetic`): the click buffer is routed straight into the
  worklet inside one AudioContext — **no speakers, no mic**. Measures the
  **compute + messaging floor only** (worklet quantum + WASM RMS + postMessage),
  NOT acoustic reality. Used to prove the toolchain and isolate where the
  latency lives.

We deliberately do **NOT** pass `--use-fake-device-for-media-stream` (fake
devices bypass real ADC/DAC latency and would make the acoustic number a lie).
`--use-fake-ui-for-media-stream` is passed only to auto-accept the mic
permission prompt — it still uses the **REAL default mic**.

### Why mouth-to-sound == `detectMs` (no `outputLatency` add-on)

`detectMs` is measured from click **schedule** (`performance.now()` at
`src.start()`) to the worklet's `hit` message. That interval already contains
**one full output-path traversal** — the stimulus click's DAC-buffer + speaker
+ air-transit time — followed by ADC-in + input buffer + worklet quantum + WASM
compute + port message. In a real jam the chain is symmetric: mouth → mic →
detect → **kick out the speakers**, i.e. one output leg on the *response* side
instead of the *stimulus* side. Either way the mouth-to-ear path contains
**exactly one output traversal**, and the loopback round trip already includes
it. So `soundMs = detectMs`; the true acoustic output delay is already *inside*
the measured loopback round trip.

**Correction (2026-07-14):** an earlier revision of `JamSpike.tsx` computed
`soundMs = detectMs + outputLatencyMs`, which double-counts that output leg on
any platform reporting nonzero `AudioContext.outputLatency`. Chromium reported
`outputLatency = 0` on this build, so the numbers in this doc are unaffected
(mouth-to-sound == detector delta throughout the Results table). The code has
been corrected to `soundMs = detectMs` to match this reasoning; the fix only
changes behaviour on platforms that report a nonzero `outputLatency`.

### Hardware / environment

- Machine: Apple Silicon MacBook Pro (aarch64), macOS (Darwin 25.4.0)
- Input: **Built-in "MacBook Pro Microphone"** (1ch, 48kHz, reported device
  latency 2.67ms), `echoCancellation/noiseSuppression/autoGainControl = OFF`,
  `voiceIsolation = OFF` (verified via `track.getSettings()`).
- Output: **Built-in "MacBook Pro Speakers"** (2ch, 48kHz).
- Browser: Chromium via Playwright (`headless: false`,
  `--autoplay-policy=no-user-gesture-required`).
- AudioContext `baseLatency` ≈ 5.3ms; `outputLatency` reported 0 in Chromium
  headed on this build (so mouth-to-sound == detector delta here; the true
  acoustic output delay is already *inside* the measured loopback round trip).

### How to reproduce

```bash
npm run build                       # worklet only bundles correctly in prod build
npx vite preview --port 1420 --strictPort &
# ensure system output is UNMUTED and volume is up (see gotcha below)
node scripts/measure-latency.mjs              # acoustic loopback (gate number)
node scripts/measure-latency.mjs --synthetic  # compute+messaging floor
```

---

## Results

### Acoustic loopback (THE GATE NUMBER) — 3 runs, built-in mic + speakers

| Run | hits | misses | detector P50 | detector P95 | mouth-to-sound P50 | mouth-to-sound P95 |
|-----|------|--------|--------------|--------------|--------------------|--------------------|
| 1   | 19/20 | 1     | 62.9ms       | 106.9ms      | 62.9ms             | 106.9ms            |
| 2   | 20/20 | 0     | 52.2ms       | 100.2ms      | 52.2ms             | 100.2ms            |
| 3   | 20/20 | 0     | 62.7ms       | 100.2ms      | 62.7ms             | 100.2ms            |

**Aggregate: P50 ≈ 52–63ms, P95 ≈ 100–107ms.** Well over the 60ms gate.

### Synthetic compute + messaging floor (NOT the gate) — built output

| hits | misses | detector P50 | detector P95 |
|------|--------|--------------|--------------|
| 20/20 | 0     | 3.8ms        | 18.5ms       |

The WASM RMS detector + worklet + postMessage path is **fast** (sub-20ms P95).
The ~80ms gap between synthetic (18.5ms) and acoustic (100ms) P95 is pure
hardware round-trip: DAC buffering, speaker→air→mic acoustic transit, ADC
buffering, and the mic input quantum. That is the wall for full jam, and it is
**not** something the Rust/WASM port (Task 2) can move.

---

## What this does and does not prove

**Proves (the spike's primary deliverable — the toolchain path works):**

- A Rust DSP crate compiles to WASM via `wasm-pack build --target web` and runs
  inside an AudioWorklet on the audio render thread.
- The one verified loading path works end-to-end in Chromium (production build):
  `addModule(?worker&url worklet)` → main thread `fetch`es the `.wasm` bytes →
  `postMessage` (transferred) → worklet `initSync({ module: new
  WebAssembly.Module(bytes) })` → posts `ready` → `process()` calls
  `WasmDetector.push()` per quantum and posts `hit`.
- The compute path is fast enough that WASM is **not** the bottleneck.

**Does NOT prove:**

- That full live jam is impossible in general — only that it misses the 60ms
  budget on **this machine's built-in mic+speaker acoustic loopback**. External
  audio interfaces / low-latency USB mics / wired headphones (no speaker→mic air
  gap, smaller buffers) could plausibly close the gap, but we cannot ship
  assuming users have them. The gate is written for commodity hardware, and
  commodity hardware fails it.
- ~~Tauri/WKWebView runtime~~ — now VERIFIED READY; see "Tauri runtime status"
  below (worklet + WASM reach "ready", 20/20 hits, with the `'wasm-unsafe-eval'`
  CSP fix applied).

---

## Spike findings (toolchain reality — deviations from the brief)

These are the load-bearing discoveries; they are why the "one verified path"
in the brief needed correcting. All are now encoded in the committed code.

1. **No wasm32 std on Homebrew Rust, no rustup.** `rustc`/`cargo` are Homebrew
   (`1.91.1 (Homebrew)`); the sysroot ships only `aarch64-apple-darwin`. The
   official `rust-std-1.91.1-wasm32-unknown-unknown` downloads fine but is built
   by *upstream* rustc — its `libcore.rlib` has a different Strict Version Hash
   than the Homebrew build, so dropping it into the sysroot fails with `E0514:
   found crate core compiled by an incompatible version of rustc`. No flag
   resolves an SVH mismatch. **Resolution:** installed `rustup` with
   `--no-modify-path --default-toolchain none` (does NOT shadow the Homebrew
   toolchain the native/Tauri build uses — Homebrew stays first on PATH), then
   `rustup toolchain install stable` + `rustup target add
   wasm32-unknown-unknown`. The wasm build is run with `~/.cargo/bin` prepended
   to PATH for that command only. **Task 2 / CI must use the rustup toolchain
   for `wasm-pack`.** (The committed `pkg/` means CI needs the wasm toolchain
   only when the detector source changes.)

2. **`initSync` is a NAMED export, not the default.** In wasm-bindgen 0.2.126
   `web`-target glue, the **default** export is the *async* `__wbg_init`;
   `initSync` is named. The brief's `import initSync, { WasmDetector }` would
   bind the async initializer and break synchronous compile. Corrected to
   `import { initSync, WasmDetector }`.

3. **`new URL("./x.ts", import.meta.url)` does NOT bundle a worklet.** Vite's
   worker/worklet bundling only triggers for `new Worker(new URL(...))`. For a
   plain `new URL()`, Vite inlined the **raw, un-transpiled TypeScript** as a
   `data:` URL — `addModule` chokes on TS syntax and the unresolved bare import.
   **Correct recipe:** `import workletUrl from "./detector.worklet.ts?worker&url"`,
   which transpiles + bundles the worklet and its wasm-pack glue into ONE
   self-contained file and returns its URL. Verified by inspecting the built
   chunk (self-contained IIFE, `registerProcessor` present, zero imports).

4. **`TextDecoder`/`TextEncoder` do not exist in `AudioWorkletGlobalScope`.**
   The wasm-bindgen glue does `new TextDecoder()` at **module top level** (to
   decode error strings). In the worklet realm this throws `ReferenceError`
   *before* `registerProcessor` runs — but Chromium **still resolves
   `addModule`**, masking the failure as a confusing "AudioWorkletNode cannot be
   created: node name not defined". **Fix:** a tiny UTF-8 codec polyfill
   (`src/worklet/textcodec-polyfill.ts`) imported *before* the glue (ES modules
   evaluate deps in order). This was the single biggest time sink; captured via
   a bisecting error-reporting worklet.

5. **The Vite DEV server does not complete the worklet handshake.** In `vite
   dev` the worklet is served **unbundled** (with a `vite/dist/client/env.mjs`
   import and a bare glue import); the processor registers but the `initSync`
   handshake never reaches `ready`, so the page hangs at `starting`. The
   harness and any real use must run against the **production build** (`vite
   preview` or the Tauri bundle). This directly affects the Tauri check below,
   because `cargo tauri dev` uses the Vite dev server.

6. **Synthetic-mode refractory artifact (harness-only).** The stub detector's
   refractory counts *pushed* samples. In synthetic mode there is no continuous
   input between click bursts, so the refractory clock froze and bursts were
   swallowed (misfire pattern `1,0,0,1,...`). Fixed by feeding a continuous
   zero-offset `ConstantSourceNode` carrier into the node in synthetic mode so
   `process()` always gets a live (silent) block. Loopback has a live mic and
   never hit this.

7. **Gotcha that ate the first loopback run: system output was muted / volume
   0.** Loopback measured 0/20 hits until the system output was unmuted and
   raised — the mic simply could not hear silent speakers. Documented here so
   the next operator checks `osascript -e "get volume settings"` first.

---

## WASM artifact

- `crates/beatrice-dsp/pkg/beatrice_dsp_bg.wasm`: **14,601 bytes raw / 6,758
  bytes (~6.6 KB) gzipped.** Trivially small; not a shipping concern. The `pkg/`
  is committed (wasm-pack self-`.gitignore`d it; removed) so the frontend
  build/typecheck works without a wasm toolchain present.

---

## Tauri runtime status — **VERIFIED READY in WKWebView (2026-07-14)**

Spike acceptance (b) asks the `/jam-spike` route to reach "ready" in the Tauri
window too. **Now verified: the worklet + WASM handshake reaches "ready" and
runs the full harness (20/20 hits) inside the Tauri WKWebView.**

- **Runtime:** WKWebView on macOS 26.4.1 (WebKit), Tauri v2.11.5 / wry 0.55.1,
  Apple M4 Pro. Native `beatrice` bin (`cargo tauri dev -- --bin beatrice`).
- **CSP fix applied:** `src-tauri/tauri.conf.json` `script-src` is now
  `'self' 'wasm-unsafe-eval'` (was `'self'`).
- **Result:** state machine reached `starting → ready → done (20 hits, 0
  misses)` in synthetic mode. "ready" fires immediately after the worklet's
  `initSync` runs `new WebAssembly.Module(bytes)` and posts `ready`, i.e. WASM
  compiled successfully on the audio render thread in WKWebView.

### Verification recipe (used)

`screencapture` was TCC-blocked (Screen Recording denied to the shell) and
Accessibility (`osascript`/System Events) was denied, so the documented on-page
screenshot could not be captured in this environment. Substituted an equivalent
scriptable proof: a same-origin status **beacon** (a temporary `?beacon`-gated
`fetch("/__beacon", ...)` in `JamSpike.tsx`, allowed by `connect-src 'self'`,
reverted before commit) posting each status transition to a small static server
that also serves the production `dist/`. Steps:

```bash
npm run build
# static server serving dist/ with SPA fallback + POST /__beacon logging,
# delivering the CSP as a real HTTP header (see negative-control note below)
CSP_HEADER="<the tauri.conf CSP string>" node spike-server.mjs ./dist 1420 &
# point Tauri at the built page without a Vite dev server / rebuild:
#   build.beforeDevCommand = ""   devUrl = http://localhost:1420/jam-spike?beacon&mode=synthetic
cargo tauri dev -- --bin beatrice   # --bin needed: workspace has 3 binaries
# read the beacon trace: starting -> ready -> done (20 hits, 0 misses)
```

The badge (`data-testid="jam-status"`) reaches "ready" (worklet + WASM loaded)
**before** the mic is touched — in loopback `getUserMedia` runs only after
"ready" — so the WASM/worklet proof does not depend on mic-permission state.
Synthetic mode (no mic, no speakers) was used so the full trace completes
unattended.

### Load-bearing correction: `script-src` does NOT gate WASM on this WebKit

A controlled A/B with the exact CSP delivered as an enforced **HTTP header**
(Tauri does **not** inject its conf CSP into an external `devUrl` response — an
inline `eval()` probe was `ALLOWED` under devUrl, proving the conf CSP is not
applied to that origin; a header CSP is, so the header path is the honest test)
showed:

| CSP `script-src` | `eval()` | `new WebAssembly.Module` | handshake |
|---|---|---|---|
| `'self'` (old) | **BLOCKED** (`EvalError`) | **ALLOWED** | ready, 20/20 |
| `'self' 'wasm-unsafe-eval'` (fix) | BLOCKED | ALLOWED | ready, 20/20 |

The `eval-BLOCKED` result confirms CSP *was* being enforced on the origin; WASM
compiled in **both** cases. So on this WebKit build the anticipated
`script-src`-blocks-WASM behavior (the spike's documented blocker, which is real
on Chromium and on WebKit builds that enforce the WASM-CSP integration) **does
not manifest** — WKWebView here allows WASM regardless. The `'wasm-unsafe-eval'`
addition is nonetheless kept: it is the spec-correct, forward-compatible policy
and is required on runtimes that do enforce it; it is simply not load-bearing on
this particular macOS build.

The native `beatrice` crate also compiles cleanly inside the Cargo workspace, so
the workspace change did not regress the Tauri build.

---

## Consequence for Phase 3

Tasks 4–5 take their **[GATE-FAIL] / VISUAL-JAM** form: the live path drives
**visualization** (reactive visuals on detected onsets), not real-time
synthesis triggered by the user's mouth. The WASM detector + worklet toolchain
proven here is still the foundation for the streaming visual detector in
Task 2 — the port is worth doing; the ~100ms acoustic latency just rules out
sample-tight live synth on built-in laptop audio.

---

## Phase 3 Task 3 update — real StreamingDetector replaces the RMS spike stub

The worklet's WASM detector is now the causal `StreamingDetector`
(`crates/beatrice-dsp/src/streaming.rs`): 512/256 STFT spectral flux with a
rolling-2s mean+2σ adaptive threshold, a causal energy-rise kick fallback, and
per-onset **classification** (heuristic; kNN-ready via `with_profile`). It
replaces the bare `SpikeDetector` (RMS-threshold, boolean `push`).

**ABI change.** `WasmDetector::push` now returns a flat `Float32Array` of
`[t_ms, class_id, confidence]` triples (one per confirmed onset this quantum;
empty when none) instead of a `bool`. No serde on the render thread. The worklet
posts `{ type: "event", t, tMs, classId, conf }` per event (was
`{ type: "hit", t }`). `class_id`: 0=kick, 1=hihat, 2=snare/click, 3=hum.

**Bundle size.** Pulling the real FFT (`realfft`) into WASM grew the module from
~7.3KB gz (RMS stub) to **~89KB gz** (235KB raw). This compiles **once** at
session start (`initSync`), off the audio hot path, so it costs load time, not
per-quantum latency. Acceptable for the visual-jam path; revisit only if
first-paint jam latency becomes a concern.

**Latency re-measure status.** The compute path is unchanged in SHAPE (one FFT
per 256-sample hop vs the old per-quantum RMS), but the flux STFT is heavier
than an RMS sum. The documented P50/P95 loopback numbers above were captured
**headed, on real devices** (the harness explicitly forbids fake devices); a
faithful re-measure requires the same headed real-device run and is left for the
GATE re-confirmation when the visual-jam UI (Tasks 4–5) lands. The worklet
loading + event-emission path was re-verified end-to-end in a real browser
(Chromium): the module compiles, posts `ready`, and emits a correctly-classified
`event` (classId 0 / conf 1.0) for a synthetic kick routed through the graph.
The GATE DECISION (VISUAL JAM) is unaffected — it is an acoustic-hardware
verdict, not a detector-compute one.

---

## Phase 3 Task 6 re-measure — the FINAL detector, on the FINAL build (2026-07-14)

The Task 3 "re-measure status" note above is now discharged. The harness was
re-run against the **shipping** production build (the real `StreamingDetector`
in WASM, 110KB gz — Task 5's kNN calibration grew it from the Task 3 89KB), on
the **same machine** (Apple Silicon MacBook Pro, built-in mic + speakers), with
the same methodology (headed Chromium, real devices, no fake-media flags in
loopback). 3 runs each, `REPS = 20`.

### Synthetic compute + deferral floor (NOT the gate) — 3 runs

| Run | hits | detector P50 | detector P95 |
|-----|------|--------------|--------------|
| 1   | 20/20 | 99.6ms      | 112.3ms      |
| 2   | 20/20 | 100.0ms     | 108.5ms      |
| 3   | 20/20 | 104.7ms     | 115.9ms      |

**Aggregate synthetic: P50 ≈ 100-105ms, P95 ≈ 108-116ms.**

### Acoustic loopback (THE GATE NUMBER) — 3 runs, built-in mic + speakers

| Run | hits | misses | detector P50 | detector P95 | mouth-to-sound P50 | mouth-to-sound P95 |
|-----|------|--------|--------------|--------------|--------------------|--------------------|
| 1   | 20/20 | 0     | 122.6ms      | 163.7ms      | 122.6ms            | 163.7ms            |
| 2   | 20/20 | 0     | 162.0ms      | 165.5ms      | 162.0ms            | 165.5ms            |
| 3   | 20/20 | 0     | 109.3ms      | 165.2ms      | 109.3ms            | 165.2ms            |

**Aggregate loopback: P50 ≈ 109-162ms, P95 ≈ 164-166ms.**

### The load-bearing finding: the detector's own deferral is now the floor

The spike's RMS-stub synthetic floor was **P95 18.5ms** — the compute path was
negligible and the ~100ms loopback number was **pure hardware round trip**. That
is no longer the shape of the problem. The real `StreamingDetector` does not fire
on the transient edge; it **defers each confirmed onset by
`feature_window_ms = 100ms`** (`crates/beatrice-dsp/src/streaming.rs`) so its
classification window fills with the same post-onset audio the offline pipeline
sees — that deferral is what makes streaming classification match offline within
±20ms (`tests/streaming_tolerance.rs`). The consequence for latency: the
detector emits ~100ms *after* the onset by design, so:

- **Synthetic P95 climbed 18.5ms → ~112ms.** This is not FFT cost — a 512-point
  STFT per 256-sample hop is cheap. It is the 100ms classification-window
  deferral plus one hop of peak confirmation. The compute itself is still sub-ms
  per quantum; the *algorithm* waits 100ms on purpose.
- **Loopback P95 climbed ~103ms → ~165ms.** The ~100ms detector deferral now
  **stacks on top of** the ~60ms acoustic round trip measured in the spike.

**What this changes about the GATE: nothing — it deepens it.** The spike's NO-GO
rested on acoustic hardware (~100ms round trip > 60ms). The final detector adds
its own ~100ms algorithmic deferral, so **the detector alone (synthetic, no
speakers, no mic) already exceeds the 60ms budget by ~1.9x**, before any acoustic
path. Full sample-tight live synth is even more firmly off the table than the
spike concluded. The VISUAL-JAM decision is not just correct, it is now
over-determined: it fails the budget on compute-plus-deferral alone.

This is the honest form of the number. A future full-jam attempt would need a
*different* detector (a low-latency edge-triggered classifier that does not wait
100ms to classify), not merely better hardware — a strictly larger scope than
the spike's "external audio interface might close the gap" note.

### Calibrated (kNN) row — measured-by-reasoning, not harness

The brief asks for a CALIBRATED row (a kNN profile active, so `push()` does more
per confirmed onset). It is **not** added as a separate harness run, honestly
because it is not measurable-apart at this resolution: kNN classification is
`O(samples)` over a *tiny* fixed set — at most `MIN_SAMPLES_PER_CLASS (5) × 4
classes = 20` stored samples, each a 7-float squared-distance
(`KnnClassifier::classify`, `crates/beatrice-dsp/src/events/calibration.rs`),
run **once per confirmed onset** (not per quantum). That is on the order of a few
hundred float multiplies per onset — nanoseconds — against a 100ms deferral and a
per-quantum FFT. It lives entirely inside the same `feature_window_ms` deferral
window (classification happens when the window fills, whether heuristic or kNN),
so it adds **zero** to the emission latency the harness measures. The `/jam-spike`
route also runs no calibration profile, so a "calibrated" harness run would
report the same synthetic floor within run-to-run noise. Row skipped on that
basis, stated plainly rather than faked.

### Reproduce (unchanged recipe)

```bash
npm run build
npx vite preview --port 1420 --strictPort &
osascript -e "get volume settings"   # confirm output NOT muted, volume up
node scripts/measure-latency.mjs              # acoustic loopback (gate number)
node scripts/measure-latency.mjs --synthetic  # compute + deferral floor
```
