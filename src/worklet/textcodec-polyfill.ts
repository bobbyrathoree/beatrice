// textcodec-polyfill — SPIKE FINDING fix.
//
// wasm-bindgen's `web`-target glue instantiates `new TextDecoder()` (and, for
// crates that pass strings in, `TextEncoder`) at MODULE TOP LEVEL, to decode
// error strings. But `AudioWorkletGlobalScope` does NOT expose TextDecoder /
// TextEncoder (unlike Window or Worker scope). So when the glue is bundled into
// the worklet and evaluated, `new TextDecoder()` throws a ReferenceError, the
// module aborts, and `registerProcessor` never runs — `addModule` still
// resolves, which masks the failure as a confusing "node name not defined".
//
// This module defines minimal UTF-8 TextDecoder/TextEncoder on the worklet
// globalThis. It MUST be imported before the wasm-pack glue so its body runs
// first (ES modules evaluate imported dependencies depth-first, in order). The
// beatrice-dsp API only decodes strings on the error/panic path, so throughput
// correctness is not a concern here; we still implement real UTF-8.

// Assign through an index-signature view so we don't fight lib.dom's concrete
// TextDecoder/TextEncoder constructor types (this file installs stand-ins for
// realms — the AudioWorklet scope — where those globals are genuinely absent).
const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.TextDecoder === "undefined") {
  class MiniTextDecoder {
    readonly encoding = "utf-8";
    readonly fatal: boolean;
    readonly ignoreBOM = false;
    constructor(_label?: string, options?: { fatal?: boolean }) {
      this.fatal = options?.fatal ?? false;
    }
    decode(input?: ArrayBufferView | ArrayBuffer): string {
      if (!input) return "";
      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let out = "";
      let i = 0;
      while (i < bytes.length) {
        const b0 = bytes[i++];
        let cp: number;
        if (b0 < 0x80) {
          cp = b0;
        } else if (b0 >= 0xc0 && b0 < 0xe0) {
          cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (b0 >= 0xe0 && b0 < 0xf0) {
          cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
          cp =
            ((b0 & 0x07) << 18) |
            ((bytes[i++] & 0x3f) << 12) |
            ((bytes[i++] & 0x3f) << 6) |
            (bytes[i++] & 0x3f);
        }
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  }
  g.TextDecoder = MiniTextDecoder;
}

if (typeof g.TextEncoder === "undefined") {
  class MiniTextEncoder {
    readonly encoding = "utf-8";
    encode(str = ""): Uint8Array {
      const bytes: number[] = [];
      for (const ch of str) {
        let cp = ch.codePointAt(0)!;
        if (cp < 0x80) {
          bytes.push(cp);
        } else if (cp < 0x800) {
          bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
          bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        } else {
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          );
        }
      }
      return new Uint8Array(bytes);
    }
    encodeInto(str: string, dest: Uint8Array): { read: number; written: number } {
      const encoded = this.encode(str);
      const written = Math.min(encoded.length, dest.length);
      dest.set(encoded.subarray(0, written));
      return { read: str.length, written };
    }
  }
  g.TextEncoder = MiniTextEncoder;
}
