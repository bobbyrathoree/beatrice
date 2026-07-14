// detector.worklet.ts — an ES-module AudioWorklet that runs the WASM detector
// on the audio render thread.
//
// ============================ MESSAGE ABI ============================
//
// OUTBOUND (worklet -> main):
//   { type: "ready" }                                   after WASM init
//   { type: "event", t, tMs, classId, conf, features }  per confirmed onset
//     - t        : shared worklet clock (seconds) for scheduling
//     - tMs      : onset's estimated time relative to STREAM START
//     - classId  : EventClass id (0=kick, 1=hihat, 2=snare/click, 3=hum)
//     - conf     : classification confidence [0,1]
//     - features : [centroid, zcr, low, mid, high, peak, crest] — the 7-float
//                  EventFeatures vector, forwarded so the calibration panel can
//                  echo a detected event straight back as a labeled sample
//                  ({type:"calibrate"}) without re-deriving features.
//
// INBOUND (main -> worklet):
//   { type: "wasm", bytes }              compile+instantiate the detector
//   { type: "calibrate", classId, features }
//                                        add a labeled few-shot sample (Task 5)
//   { type: "setCalibration", enabled }  flip the HEURISTIC/YOURS A/B toggle
//   { type: "resetCalibration" }         drop the live profile before a re-teach
//                                        (so new samples don't append onto a
//                                        re-seeded profile — kNN reverts to None)
//
// WASM push() ABI: a flat Float32Array of EVENT_STRIDE (10) floats per event —
//   [tMs, classId, conf, centroid, zcr, low, mid, high, peak, crest]
// JSON-free, no serde on the render thread. Empty means "no event this quantum".
// EVENT_STRIDE and the feature order MUST match crates/beatrice-dsp/src/lib.rs
// (WASM_EVENT_STRIDE + WasmDetector::push); bump both in lockstep.
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

/** Floats per event record in the push() ABI (see crate WASM_EVENT_STRIDE). */
const EVENT_STRIDE = 10;

interface WasmMessage {
  type: "wasm";
  bytes: ArrayBuffer;
}
interface CalibrateMessage {
  type: "calibrate";
  classId: number;
  features: number[] | Float32Array;
}
interface SetCalibrationMessage {
  type: "setCalibration";
  enabled: boolean;
}
interface ResetCalibrationMessage {
  type: "resetCalibration";
}
type InboundMessage =
  | WasmMessage
  | CalibrateMessage
  | SetCalibrationMessage
  | ResetCalibrationMessage;

class DetectorProcessor extends AudioWorkletProcessor {
  private det: WasmDetector | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InboundMessage>) => {
      const msg = e.data;
      if (msg.type === "wasm") {
        // Synchronous compile from the posted bytes. Passing a WebAssembly.Module
        // avoids any async instantiate on the audio thread.
        initSync({ module: new WebAssembly.Module(msg.bytes) });
        this.det = new WasmDetector(sampleRate);
        this.port.postMessage({ type: "ready" });
      } else if (msg.type === "calibrate") {
        // Few-shot: add a labeled sample to the live profile (Task 5).
        this.det?.add_calibration_sample(
          msg.classId >>> 0,
          msg.features instanceof Float32Array
            ? msg.features
            : new Float32Array(msg.features)
        );
      } else if (msg.type === "setCalibration") {
        // A/B toggle: kNN-first (personal) vs heuristic-only.
        this.det?.set_calibration_enabled(!!msg.enabled);
      } else if (msg.type === "resetCalibration") {
        // Re-teach begins: drop any re-seeded profile so fresh samples don't
        // append onto it (kNN reverts to None until the new profile refills).
        this.det?.clear_calibration();
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch || !this.det) return true;

    // The WASM StreamingDetector returns a flat Float32Array of EVENT_STRIDE-
    // float records — one per confirmed onset this quantum (usually empty).
    // JSON-free by design: no serde on the render thread. `tMs` is the onset's
    // estimated time relative to STREAM START; `currentTime` is the shared
    // worklet/AudioContext clock (seconds) callers use for scheduling. We
    // forward both plus the feature vector (for calibration echo-back).
    const recs = this.det.push(ch);
    for (let i = 0; i + EVENT_STRIDE - 1 < recs.length; i += EVENT_STRIDE) {
      this.port.postMessage({
        type: "event",
        t: currentTime,
        tMs: recs[i],
        classId: recs[i + 1],
        conf: recs[i + 2],
        features: [
          recs[i + 3],
          recs[i + 4],
          recs[i + 5],
          recs[i + 6],
          recs[i + 7],
          recs[i + 8],
          recs[i + 9],
        ],
      });
    }
    return true;
  }
}

registerProcessor("beatrice-detector", DetectorProcessor);
