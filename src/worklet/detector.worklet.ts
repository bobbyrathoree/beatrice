// detector.worklet.ts — an ES-module AudioWorklet that runs the WASM detector
// on the audio render thread.
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
    if (ch && this.det?.push(ch)) {
      // `currentTime` is the worklet clock in seconds, shared with the main
      // AudioContext — the harness converts the delta to ms.
      this.port.postMessage({ type: "hit", t: currentTime });
    }
    return true;
  }
}

registerProcessor("beatrice-detector", DetectorProcessor);
