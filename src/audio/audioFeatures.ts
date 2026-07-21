// audioFeatures.ts — pure, shippable audio-analysis helpers.
//
// These functions turn rendered WAV bytes (16-bit stereo PCM, 44-byte header)
// into scalar/vector features used to PROVE that two theme "sounds" differ
// measurably: 4-band spectral proportions, an RMS envelope, windowed energy, and
// a stereo-width proxy. The radix-2 FFT is implemented in-module so this file
// pulls in NO new dependencies and is safe to ship (no test-only imports).
//
// Everything here is a pure function of its inputs.

// ─── Radix-2 FFT (iterative Cooley–Tukey, in place) ──────────────────────────

/**
 * In-place complex radix-2 FFT. `re`/`im` are equal-length arrays whose length
 * MUST be a power of two; on return they hold the transform. Pure math — no
 * allocation of large buffers, no randomness.
 */
export function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`fftRadix2: length ${n} is not a power of two`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = i + k + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ─── WAV decode ───────────────────────────────────────────────────────────────

/** Frame count of a 16-bit stereo PCM WAV (bytes after the 44-byte header / 4). */
function stereoFrameCount(wav: Uint8Array): number {
  return Math.max(0, Math.floor((wav.byteLength - 44) / 4));
}

/** Mono mixdown of interleaved 16-bit stereo PCM (post-44-byte WAV header). */
export function wavToMono(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const frames = stereoFrameCount(wav);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = view.getInt16(44 + i * 4, true) / 32768;
    const r = view.getInt16(44 + i * 4 + 2, true) / 32768;
    out[i] = (l + r) * 0.5;
  }
  return out;
}

/** Stereo split — for chorus width checks. */
export function wavToStereo(wav: Uint8Array): { left: Float32Array; right: Float32Array } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const frames = stereoFrameCount(wav);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(44 + i * 4, true) / 32768;
    right[i] = view.getInt16(44 + i * 4 + 2, true) / 32768;
  }
  return { left, right };
}

// ─── Spectral band proportions ────────────────────────────────────────────────

const FRAME_SIZE = 4096;
const HOP = FRAME_SIZE / 2; // 50% overlap
// Band edges in Hz: [<150], [150–800), [800–4000), [>=4000].
const BAND_EDGES = [150, 800, 4000];

/** Which of the 4 bands a frequency (Hz) falls in. */
function bandOf(freqHz: number): 0 | 1 | 2 | 3 {
  if (freqHz < BAND_EDGES[0]) return 0;
  if (freqHz < BAND_EDGES[1]) return 1;
  if (freqHz < BAND_EDGES[2]) return 2;
  return 3;
}

/** Precomputed Hann window for FRAME_SIZE. */
const HANN = (() => {
  const w = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1)));
  }
  return w;
})();

/**
 * Energy proportions in 4 bands: <150, 150-800, 800-4000, >4000 Hz.
 * Radix-2 FFT, 4096-pt frames, Hann, 50% overlap; proportions sum to 1
 * (all-zero / silent input → [0,0,0,0]). Signals shorter than one frame are
 * analyzed as a single zero-padded frame.
 */
export function bandProportions(
  mono: Float32Array,
  sampleRate: number,
): [number, number, number, number] {
  const bands: [number, number, number, number] = [0, 0, 0, 0];
  const n = mono.length;
  if (n === 0) return bands;

  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  // Bin k (0..FRAME_SIZE/2) maps to k * sampleRate / FRAME_SIZE Hz.
  const binHz = sampleRate / FRAME_SIZE;

  // Iterate hop-aligned frames; guarantee at least one (zero-padded) frame for
  // short inputs so a sub-frame signal is still analyzed.
  const lastStart = Math.max(0, n - FRAME_SIZE);
  for (let start = 0; ; start += HOP) {
    const s = Math.min(start, lastStart);
    for (let i = 0; i < FRAME_SIZE; i++) {
      const idx = s + i;
      re[i] = idx < n ? mono[idx] * HANN[i] : 0;
      im[i] = 0;
    }
    fftRadix2(re, im);
    // Sum power over positive-frequency bins (skip DC to ignore any offset).
    for (let k = 1; k <= FRAME_SIZE / 2; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      bands[bandOf(k * binHz)] += power;
    }
    if (s >= lastStart) break;
  }

  const total = bands[0] + bands[1] + bands[2] + bands[3];
  if (total <= 0) return [0, 0, 0, 0];
  return [bands[0] / total, bands[1] / total, bands[2] / total, bands[3] / total];
}

// ─── RMS envelope ───────────────────────────────────────────────────────────

/**
 * RMS envelope: non-overlapping `windowSec` windows, each normalized by the
 * overall RMS of the whole signal (silence → all zeros). One value per full
 * window (a trailing partial window is dropped).
 */
export function rmsEnvelope(
  mono: Float32Array,
  sampleRate: number,
  windowSec: number,
): Float32Array {
  const win = Math.max(1, Math.round(windowSec * sampleRate));
  const n = mono.length;
  const count = Math.floor(n / win);
  const out = new Float32Array(count);
  if (count === 0) return out;

  // Overall RMS for normalization.
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += mono[i] * mono[i];
  const overallRms = Math.sqrt(sumSq / n);
  if (overallRms <= 0) return out; // silence → zeros

  for (let w = 0; w < count; w++) {
    let s = 0;
    const base = w * win;
    for (let i = 0; i < win; i++) {
      const v = mono[base + i];
      s += v * v;
    }
    out[w] = Math.sqrt(s / win) / overallRms;
  }
  return out;
}

// ─── Vector distances ─────────────────────────────────────────────────────────

/** SUM of |a[i]-b[i]| over min length (conventional L1 — name says what it is). */
export function l1Sum(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

/** MEAN of |a[i]-b[i]| over min length. */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

// ─── Windowed energy ────────────────────────────────────────────────────────

/**
 * Sum of squared samples in the time window [startSec, endSec). Bounds are
 * clamped to the available signal, so reading past the end simply contributes
 * nothing (a shorter render measures whatever it actually has).
 */
export function energyInWindow(
  mono: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number,
): number {
  const from = Math.max(0, Math.floor(startSec * sampleRate));
  const to = Math.min(mono.length, Math.floor(endSec * sampleRate));
  let sum = 0;
  for (let i = from; i < to; i++) sum += mono[i] * mono[i];
  return sum;
}

// ─── Stereo width ─────────────────────────────────────────────────────────────

/**
 * Stereo width proxy: mean |L-R| / (mean(|L|+|R|)/2). Identical channels → 0,
 * inverted channels → ~2. Guards a silent/empty input to 0.
 */
export function stereoWidth(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) return 0;
  let sideSum = 0; // mean |L-R|
  let magSum = 0; // mean (|L|+|R|)/2
  for (let i = 0; i < n; i++) {
    sideSum += Math.abs(left[i] - right[i]);
    magSum += (Math.abs(left[i]) + Math.abs(right[i])) * 0.5;
  }
  if (magSum <= 0) return 0;
  return sideSum / magSum;
}
