/* @ts-self-types="./beatrice_dsp.d.ts" */

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDetectorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmdetector_free(ptr, 0);
    }
    /**
     * Add a labeled calibration sample from the main thread. `class_id` is the
     * [`class_id`] mapping (0=kick, 1=hihat, 2=snare/click, 3=hum); `features`
     * is the 7-float [`EventFeatures`] vector (same order as the trailing floats
     * in [`push`](Self::push)). Short/garbled feature slices are ignored so a
     * malformed message can never poison the profile.
     * @param {number} class_id
     * @param {Float32Array} features
     */
    add_calibration_sample(class_id, features) {
        const ptr0 = passArrayF32ToWasm0(features, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmdetector_add_calibration_sample(this.__wbg_ptr, class_id, ptr0, len0);
    }
    /**
     * The live calibration profile serialized to JSON bytes, for persistence
     * (localStorage in the browser, `create_calibration_profile` on native).
     * @returns {Uint8Array}
     */
    calibration_profile_json() {
        const ret = wasm.wasmdetector_calibration_profile_json(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Whether the accumulated profile has ≥5 samples for all 4 classes.
     * @returns {boolean}
     */
    is_calibration_sufficient() {
        const ret = wasm.wasmdetector_is_calibration_sufficient(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.wasmdetector_new(sample_rate);
        this.__wbg_ptr = ret;
        WasmDetectorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Push one render quantum. Returns [`WASM_EVENT_STRIDE`]-float records
     * (flat) for every event confirmed during this quantum; empty if none.
     * @param {Float32Array} samples
     * @returns {Float32Array}
     */
    push(samples) {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmdetector_push(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Flip the HEURISTIC/YOURS A/B toggle. `true` = personal (kNN-first once the
     * profile is sufficient); `false` = heuristic-only.
     * @param {boolean} enabled
     */
    set_calibration_enabled(enabled) {
        wasm.wasmdetector_set_calibration_enabled(this.__wbg_ptr, enabled);
    }
}
if (Symbol.dispose) WasmDetector.prototype[Symbol.dispose] = WasmDetector.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getTime_d6f070c088c9b5ed: function(arg0) {
            const ret = arg0.getTime();
            return ret;
        },
        __wbg_new_0_3da9e97f24fc69be: function() {
            const ret = new Date();
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./beatrice_dsp_bg.js": import0,
    };
}

const WasmDetectorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmdetector_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('beatrice_dsp_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
