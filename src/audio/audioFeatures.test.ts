// Step 1 — FFT / feature correctness (pure, no audio graph, runs under happy-dom).
//
// These are the FIRST gate: before proving two theme renders differ, the
// measurement primitives themselves must be proven correct on known signals
// (pure sines, silence, hand-built vectors). If these are wrong, every A/B
// assertion downstream is meaningless.
import { describe, it, expect } from "vitest";
import {
  fftRadix2,
  bandProportions,
  rmsEnvelope,
  l1Sum,
  meanAbsDiff,
  energyInWindow,
  stereoWidth,
  wavToMono,
  wavToStereo,
} from "./audioFeatures";

const SR = 44100;

/** A pure sine of `freq` Hz, `seconds` long, at `sampleRate`. */
function sine(freq: number, seconds: number, sampleRate = SR, amp = 0.8): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

describe("fftRadix2", () => {
  it("rejects non-power-of-two lengths", () => {
    expect(() => fftRadix2(new Float32Array(6), new Float32Array(6))).toThrow(/power of two/);
  });

  it("puts a pure real cosine's energy at its bin (and the mirror)", () => {
    // A cosine at bin k=4 over N=16 → magnitude concentrated at bins 4 and 12.
    const N = 16;
    const k = 4;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * k * i) / N);
    fftRadix2(re, im);
    const mag = (j: number) => Math.hypot(re[j], im[j]);
    // Bins 4 and 12 dominate; every other bin is ~0.
    expect(mag(k)).toBeGreaterThan(N / 2 - 1e-3);
    expect(mag(N - k)).toBeGreaterThan(N / 2 - 1e-3);
    for (let j = 0; j < N; j++) {
      if (j !== k && j !== N - k) expect(mag(j)).toBeLessThan(1e-3);
    }
  });
});

describe("bandProportions", () => {
  it("puts a 100Hz sine in band 0 (<150Hz)", () => {
    const p = bandProportions(sine(100, 1), SR);
    expect(p[0]).toBeGreaterThan(0.8);
    expect(p[0] + p[1] + p[2] + p[3]).toBeCloseTo(1, 5);
  });

  it("puts a 440Hz sine in band 1 (150-800Hz)", () => {
    const p = bandProportions(sine(440, 1), SR);
    expect(p[1]).toBeGreaterThan(0.8);
  });

  it("puts a 6kHz sine in band 3 (>4000Hz)", () => {
    const p = bandProportions(sine(6000, 1), SR);
    expect(p[3]).toBeGreaterThan(0.8);
  });

  it("returns [0,0,0,0] for silence", () => {
    expect(Array.from(bandProportions(new Float32Array(SR), SR))).toEqual([0, 0, 0, 0]);
  });

  it("returns [0,0,0,0] for empty input", () => {
    expect(Array.from(bandProportions(new Float32Array(0), SR))).toEqual([0, 0, 0, 0]);
  });
});

describe("rmsEnvelope", () => {
  it("is all zeros for silence", () => {
    const env = rmsEnvelope(new Float32Array(SR), SR, 0.025);
    expect(env.length).toBeGreaterThan(0);
    expect(Array.from(env).every((v) => v === 0)).toBe(true);
  });

  it("normalizes to ~1 for a steady signal", () => {
    // A constant-amplitude sine has near-uniform per-window RMS, so every window
    // ≈ overall RMS → normalized value ≈ 1.
    const env = rmsEnvelope(sine(440, 1), SR, 0.025);
    const mean = Array.from(env).reduce((a, b) => a + b, 0) / env.length;
    expect(mean).toBeCloseTo(1, 1);
  });
});

describe("l1Sum / meanAbsDiff", () => {
  it("l1Sum is the sum of absolute differences", () => {
    expect(l1Sum([1, 2, 3], [1, 0, 0])).toBe(0 + 2 + 3);
  });
  it("meanAbsDiff is the mean of absolute differences", () => {
    expect(meanAbsDiff([1, 2, 3], [1, 0, 0])).toBeCloseTo(5 / 3, 10);
  });
  it("both operate over the min length", () => {
    expect(l1Sum([1, 2, 3, 99], [1, 2, 3])).toBe(0);
    expect(meanAbsDiff([], [1, 2])).toBe(0);
  });
});

describe("energyInWindow", () => {
  it("sums squared samples inside the window and clamps bounds", () => {
    const x = new Float32Array([0, 1, 1, 1, 0, 0]); // 6 samples at sr=1
    // [1s, 4s) → indices 1,2,3 → 1+1+1 = 3
    expect(energyInWindow(x, 1, 1, 4)).toBeCloseTo(3, 10);
    // past the end clamps → 0
    expect(energyInWindow(x, 1, 10, 20)).toBe(0);
  });
});

describe("stereoWidth", () => {
  it("is 0 for identical channels", () => {
    const s = sine(440, 0.1);
    expect(stereoWidth(s, s)).toBe(0);
  });

  it("is ~2 for inverted channels", () => {
    const s = sine(440, 0.1);
    const inv = s.map((v) => -v);
    expect(stereoWidth(s, inv)).toBeCloseTo(2, 5);
  });

  it("is 0 for silence", () => {
    expect(stereoWidth(new Float32Array(10), new Float32Array(10))).toBe(0);
  });
});

describe("wav decode round-trips a hand-built stereo WAV", () => {
  // Build a 3-frame 16-bit stereo WAV: L=[0.5,-0.5,0], R=[-0.5,0.5,0].
  function buildWav(l: number[], r: number[]): Uint8Array {
    const frames = l.length;
    const out = new DataView(new ArrayBuffer(44 + frames * 4));
    for (let i = 0, o = 44; i < frames; i++, o += 4) {
      out.setInt16(o, Math.round(l[i] * 32767), true);
      out.setInt16(o + 2, Math.round(r[i] * 32767), true);
    }
    return new Uint8Array(out.buffer);
  }

  it("wavToStereo recovers each channel; wavToMono averages", () => {
    const wav = buildWav([0.5, -0.5, 0], [-0.5, 0.5, 0]);
    const { left, right } = wavToStereo(wav);
    expect(left.length).toBe(3);
    expect(left[0]).toBeCloseTo(0.5, 3);
    expect(right[0]).toBeCloseTo(-0.5, 3);
    const mono = wavToMono(wav);
    // (0.5 + -0.5)/2 = 0
    expect(mono[0]).toBeCloseTo(0, 3);
    expect(mono[2]).toBeCloseTo(0, 3);
  });
});
