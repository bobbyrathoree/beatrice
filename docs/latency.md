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
