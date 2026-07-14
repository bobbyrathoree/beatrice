// loadDetector — the shared, one-verified-path loader for the WASM detector
// AudioWorklet. Both the live jam hook (useJamSession) and the latency harness
// (JamSpike page) use this so there is exactly ONE loading sequence to trust.
//
// Sequence:
//   1. addModule(worklet URL) — Vite bundles the worklet module + its wasm-pack
//      `web`-target glue into a single ES module chunk.
//   2. Main thread fetch()es the .wasm bytes (worklet scope has no fetch).
//   3. postMessage the bytes (transferred) into the worklet.
//   4. Worklet compiles synchronously (initSync) and posts { type: "ready" }.
//
// Returns the wired AudioWorkletNode once ready. The caller is responsible for
// assigning `node.port.onmessage` to receive subsequent { type: "event" }
// messages (t, tMs, classId, conf) and for connecting a source into the node.

// SPIKE FINDING — the correct Vite recipe for AudioWorklet bundling.
//
// The brief suggested `new URL("./x.ts", import.meta.url)`, but Vite's
// worker/worklet BUNDLING only applies to `new Worker(new URL(...))`. For a
// plain `new URL()` Vite treats a .ts file as a static asset and inlines the
// RAW, un-transpiled TypeScript as a data: URL — `addModule` then fails on the
// TS syntax and the unresolved `import`. Verified by inspecting the build.
//
// The working recipe: the `?worker&url` suffix. Vite bundles the worklet entry
// (transpiling TS and inlining its imports — including the wasm-pack glue —
// into ONE self-contained file, which is exactly what a worklet scope needs
// since it can't resolve bare/relative imports) and returns the built URL.
import workletUrl from "./detector.worklet.ts?worker&url";

const wasmUrl = new URL(
  "../../crates/beatrice-dsp/pkg/beatrice_dsp_bg.wasm",
  import.meta.url
);

export async function loadDetectorNode(
  ctx: AudioContext,
  timeoutMs = 10_000
): Promise<AudioWorkletNode> {
  await ctx.audioWorklet.addModule(workletUrl);
  const node = new AudioWorkletNode(ctx, "beatrice-detector");

  const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("worklet init timed out")),
      timeoutMs
    );
    node.port.onmessage = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type === "ready") {
        clearTimeout(timer);
        node.port.onmessage = null;
        resolve();
      }
    };
    node.port.postMessage({ type: "wasm", bytes: wasmBytes }, [wasmBytes]);
  });

  return node;
}
