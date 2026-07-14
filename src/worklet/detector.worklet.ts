// detector.worklet.ts — an ES-module AudioWorklet that runs the WASM detector
// on the audio render thread.
//
// OUTBOUND MESSAGES: the detector is the causal StreamingDetector (P3 Task 3),
// which classifies as well as detects. Per confirmed onset we post
//   { type: "event", t, tMs, classId, conf }
// where `t` is the shared worklet clock (seconds) for scheduling, `tMs` is the
// onset's estimated time relative to stream start, `classId` is the EventClass
// (0=kick, 1=hihat, 2=snare/click, 3=hum), and `conf` is the confidence. The
// WASM `push` returns these as a flat Float32Array of triples — JSON-free, no
// serde on the render thread. (Earlier spike revision posted `{type:"hit"}`
// from a bare RMS SpikeDetector; consumers now key on "event".)
//
// THE ONE VERIFIED WASM-IN-WORKLET LOADING PATH (wasm-pack `web` target):
//   1. wasm-pack `web` glue is a plain ES module. AudioWorklet modules ARE ES
//      modules, so `import` works here and Vite bundles the glue into this file.
//   2. Worklet scope has no `fetch`/`URL.createObjectURL`, so the MAIN thread
//      fetches the .wasm bytes and posts them to us.
//   3. We compile+instantiate synchronously from those bytes via `initSync`.
//
// NOTE (deviation from brief, verified against wasm-bindgen 0.2.126 output):
// the pkg's DEFAULT export is the *async* `__wbg_init`; `initSync` is a NAMED
// export. So we import `{ initSync, WasmDetector }` — importing the default as
// `initSync` (as the brief sketch showed) would bind the async initializer and
// break synchronous compile. See crates/beatrice-dsp/pkg/beatrice_dsp.js.
//
// SPIKE FINDING: the glue calls `new TextDecoder()` at module top level, but
// AudioWorkletGlobalScope has no TextDecoder/TextEncoder — evaluation would
// throw before registerProcessor runs (addModule still resolves, masking it).
// This polyfill import MUST come first: ES modules evaluate dependencies in
// order, so it installs the codecs before the glue's top-level code runs.
import "./textcodec-polyfill";
import { initSync, WasmDetector } from "../../crates/beatrice-dsp/pkg/beatrice_dsp";

interface WasmMessage {
  type: "wasm";
  bytes: ArrayBuffer;
}
type InboundMessage = WasmMessage;

class DetectorProcessor extends AudioWorkletProcessor {
  private det: WasmDetector | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InboundMessage>) => {
      if (e.data.type === "wasm") {
        // Synchronous compile from the posted bytes. Passing a WebAssembly.Module
        // avoids any async instantiate on the audio thread.
        initSync({ module: new WebAssembly.Module(e.data.bytes) });
        this.det = new WasmDetector(sampleRate);
        this.port.postMessage({ type: "ready" });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch || !this.det) return true;

    // The WASM StreamingDetector returns a flat Float32Array of
    // [t_ms, classId, confidence] triples — one per confirmed onset this
    // quantum (usually empty). JSON-free by design: no serde on the render
    // thread. `t_ms` is the onset's estimated time relative to STREAM START;
    // `currentTime` is the shared worklet/AudioContext clock (seconds) callers
    // use for scheduling. We forward both so the harness keeps measuring the
    // detect delta while live consumers get the class + confidence.
    const triples = this.det.push(ch);
    for (let i = 0; i + 2 < triples.length; i += 3) {
      this.port.postMessage({
        type: "event",
        t: currentTime,
        tMs: triples[i],
        classId: triples[i + 1],
        conf: triples[i + 2],
      });
    }
    return true;
  }
}

registerProcessor("beatrice-detector", DetectorProcessor);
