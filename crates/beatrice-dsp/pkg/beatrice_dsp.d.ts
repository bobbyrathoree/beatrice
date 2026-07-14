/* tslint:disable */
/* eslint-disable */

/**
 * WASM surface over the causal [`StreamingDetector`], driven by the
 * AudioWorklet one render quantum at a time.
 *
 * # ABI (JSON-free, no serde in the hot path)
 *
 * [`push`](Self::push) returns a flat `Float32Array` of [`WASM_EVENT_STRIDE`]
 * (10) floats per event: `[t_ms, class_id, confidence, centroid, zcr,
 * low_band, mid_band, high_band, peak, crest]`. An empty array means "no event
 * this quantum" (the common case). The length is always a multiple of 10.
 * `class_id` is [`class_id`]'s mapping; the trailing 7 floats are the event's
 * [`EventFeatures`] in struct-declaration order. The worklet reads the records
 * and posts one `{ type: "event", tMs, classId, conf, features }` message per
 * event. The features let the calibration panel echo a detected event back via
 * [`add_calibration_sample`](Self::add_calibration_sample) as a labeled sample.
 *
 * # Calibration (Task 5, few-shot personalization)
 *
 * [`add_calibration_sample`](Self::add_calibration_sample) feeds a labeled
 * example into the live profile; [`set_calibration_enabled`](Self::set_calibration_enabled)
 * flips the HEURISTIC/YOURS A/B toggle. Both are cheap main→worklet messages.
 */
export class WasmDetector {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a labeled calibration sample from the main thread. `class_id` is the
     * [`class_id`] mapping (0=kick, 1=hihat, 2=snare/click, 3=hum); `features`
     * is the 7-float [`EventFeatures`] vector (same order as the trailing floats
     * in [`push`](Self::push)). Short/garbled feature slices are ignored so a
     * malformed message can never poison the profile.
     */
    add_calibration_sample(class_id: number, features: Float32Array): void;
    /**
     * The live calibration profile serialized to JSON bytes, for persistence
     * (localStorage in the browser, `create_calibration_profile` on native).
     */
    calibration_profile_json(): Uint8Array;
    /**
     * Drop the live calibration profile (kNN reverts to `None`, so
     * classification falls back to the heuristic). Sent when a re-teach begins
     * so new samples do not APPEND onto a profile the worklet was re-seeded with
     * on jam start — otherwise the live profile would drift from what the panel
     * accumulates and persists to localStorage.
     */
    clear_calibration(): void;
    /**
     * Whether the accumulated profile has ≥5 samples for all 4 classes.
     */
    is_calibration_sufficient(): boolean;
    constructor(sample_rate: number);
    /**
     * Push one render quantum. Returns [`WASM_EVENT_STRIDE`]-float records
     * (flat) for every event confirmed during this quantum; empty if none.
     */
    push(samples: Float32Array): Float32Array;
    /**
     * Flip the HEURISTIC/YOURS A/B toggle. `true` = personal (kNN-first once the
     * profile is sufficient); `false` = heuristic-only.
     */
    set_calibration_enabled(enabled: boolean): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmdetector_free: (a: number, b: number) => void;
    readonly wasmdetector_add_calibration_sample: (a: number, b: number, c: number, d: number) => void;
    readonly wasmdetector_calibration_profile_json: (a: number) => [number, number];
    readonly wasmdetector_clear_calibration: (a: number) => void;
    readonly wasmdetector_is_calibration_sufficient: (a: number) => number;
    readonly wasmdetector_new: (a: number) => number;
    readonly wasmdetector_push: (a: number, b: number, c: number) => [number, number];
    readonly wasmdetector_set_calibration_enabled: (a: number, b: number) => void;
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
