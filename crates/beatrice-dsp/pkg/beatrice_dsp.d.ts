/* tslint:disable */
/* eslint-disable */

/**
 * WASM surface over the causal [`StreamingDetector`], driven by the
 * AudioWorklet one render quantum at a time.
 *
 * # ABI (JSON-free, no serde in the hot path)
 *
 * [`push`](Self::push) returns a flat `Float32Array` of **3 floats per event**:
 * `[t_ms, class_id, confidence, t_ms, class_id, confidence, ...]`. An empty
 * array means "no event this quantum" (the common case). The length is always
 * a multiple of 3. `class_id` is [`class_id`]'s mapping. The worklet reads the
 * triples and posts one `{ type: "event", t, classId, conf }` message per event
 * to the main thread. This avoids allocating/serializing JSON on the audio
 * render thread.
 */
export class WasmDetector {
    free(): void;
    [Symbol.dispose](): void;
    constructor(sample_rate: number);
    /**
     * Push one render quantum. Returns `[t_ms, class_id, confidence]` triples
     * (flat) for every event confirmed during this quantum; empty if none.
     */
    push(samples: Float32Array): Float32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmdetector_free: (a: number, b: number) => void;
    readonly wasmdetector_new: (a: number) => number;
    readonly wasmdetector_push: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
