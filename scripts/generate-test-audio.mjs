#!/usr/bin/env node
/**
 * Generate deterministic test WAV files for Beatrice pipeline verification.
 * Each file is designed to trigger a specific EventClass in the heuristic classifier.
 *
 * Expected classifications (based on heuristic.rs thresholds):
 *   test-kick.wav    → BilabialPlosive (low centroid, high low-band, low ZCR)
 *   test-hihat.wav   → HihatNoise      (high centroid, high ZCR, high high-band)
 *   test-snare.wav   → Click           (mid centroid, moderate ZCR, mid-band)
 *   test-hum.wav     → HumVoiced       (mid-low centroid, low ZCR, balanced bands)
 *   test-pattern.wav → Composite: kick @ 0s, hihat @ 0.5s, snare @ 1.0s, kick @ 1.5s
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'test-audio');

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;
const NUM_CHANNELS = 1;

// --- WAV file writer ---

function writeWav(filename, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);

  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);            // chunk size
  buf.writeUInt16LE(1, 20);             // PCM
  buf.writeUInt16LE(NUM_CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);             // block align
  buf.writeUInt16LE(BIT_DEPTH, 34);

  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  const path = join(outDir, filename);
  writeFileSync(path, buf);
  const durationMs = (numSamples / SAMPLE_RATE * 1000).toFixed(0);
  console.log(`  ${filename} (${durationMs}ms, ${numSamples} samples, ${fileSize} bytes)`);
  return path;
}

// --- Signal generators ---

/** Deterministic pseudo-random (seeded LCG) */
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;       // 0..1
  };
}

/**
 * test-kick.wav — BilabialPlosive archetype
 * 80Hz sine burst with fast exponential decay.
 * Expected features: centroid ~200Hz, low_band_energy ~0.8, ZCR ~0.05
 */
function generateKick(durationSec = 0.5) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Frequency sweep: 150Hz → 60Hz over 50ms, then 60Hz
    const freq = t < 0.05 ? 150 - (90 * t / 0.05) : 60;
    const phase = 2 * Math.PI * freq * t;
    const envelope = Math.exp(-12 * t);
    samples[i] = Math.sin(phase) * envelope * 0.9;
  }
  return samples;
}

/**
 * test-hihat.wav — HihatNoise archetype
 * High-frequency noise burst (bandpass ~6-12kHz range).
 * Expected features: centroid >4000Hz, ZCR >0.4, high_band_energy >0.5
 */
function generateHihat(durationSec = 0.3) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(42);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-25 * t);

    // Generate noise and apply simple high-pass approximation
    // Sum of high-frequency sinusoids for determinism
    let signal = 0;
    for (let f = 6000; f <= 12000; f += 500) {
      signal += Math.sin(2 * Math.PI * f * t + rand() * Math.PI * 2) * 0.15;
    }

    // Add some random-phase noise for realism
    signal += (rand() * 2 - 1) * 0.3;

    samples[i] = signal * envelope * 0.7;
  }
  return samples;
}

/**
 * test-snare.wav — Click archetype
 * Mid-frequency transient with strong body, moderate noise.
 * The Click classifier expects: centroid 1000-2500Hz, ZCR 0.2-0.5, mid_band >0.3
 * Band boundaries: low 0-500Hz, mid 500-4000Hz, high 4000+Hz
 *
 * Strategy: Strong tonal body at 800-1500Hz range, moderate noise, fast decay.
 * Keep energy BELOW 4000Hz so it stays in mid-band, not high-band.
 */
function generateSnare(durationSec = 0.3) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(123);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-18 * t);

    // Strong tonal body: 800Hz + 1200Hz + 1600Hz (mid-band emphasis)
    const body = (
      Math.sin(2 * Math.PI * 800 * t) * 0.35 +
      Math.sin(2 * Math.PI * 1200 * t) * 0.25 +
      Math.sin(2 * Math.PI * 1600 * t) * 0.15
    ) * Math.exp(-25 * t);

    // Noise — narrow band around 1000-2500Hz only, no broadband
    let noise = 0;
    for (let f = 1000; f <= 2500; f += 250) {
      noise += Math.sin(2 * Math.PI * f * t + rand() * Math.PI * 2) * 0.06;
    }

    samples[i] = (body + noise * envelope) * 0.8;
  }
  return samples;
}

/**
 * test-hum.wav — HumVoiced archetype
 * Designed to navigate the heuristic's anti-plosive penalties:
 * - Fundamental at 300Hz + harmonics at 600Hz, 900Hz, 1200Hz (pushes centroid to ~600Hz)
 * - Added breath noise for high_band_energy > 0.25 (avoids concentration penalty)
 * - Slight frequency jitter for ZCR > 0.05 (avoids pure tone penalty)
 * - Sustained (no fast decay) to distinguish from plosive transients
 *
 * Expected features: centroid ~600Hz, ZCR ~0.08, balanced energy distribution
 */
function generateHum(durationSec = 1.0) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(456);

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;

    // Slow attack + sustain + gentle release
    let envelope;
    if (t < 0.02) envelope = t / 0.02;          // 20ms attack
    else if (t < durationSec - 0.1) envelope = 1.0;
    else envelope = (durationSec - t) / 0.1;     // 100ms release

    // Fundamental with slight vibrato (jitter to avoid pure-tone penalty)
    const vibrato = 1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t);
    const f0 = 300 * vibrato;

    // Harmonics: f0, 2*f0, 3*f0, 4*f0 with decreasing amplitude
    let signal = Math.sin(2 * Math.PI * f0 * t) * 0.4;
    signal += Math.sin(2 * Math.PI * f0 * 2 * t) * 0.25;
    signal += Math.sin(2 * Math.PI * f0 * 3 * t) * 0.15;
    signal += Math.sin(2 * Math.PI * f0 * 4 * t) * 0.08;

    // Breath noise (high-frequency) to balance the spectrum
    signal += (rand() * 2 - 1) * 0.06;

    samples[i] = signal * envelope * 0.7;
  }
  return samples;
}

/**
 * test-pattern.wav — Composite pattern at 120 BPM
 * kick @ 0.0s, hihat @ 0.5s, snare @ 1.0s, kick @ 1.5s
 * Total duration: 2.0 seconds (one measure of 4/4 at 120 BPM)
 *
 * Expected: 4 onsets, tempo ~120 BPM, classes [Bilabial, Hihat, Click, Bilabial]
 */
function generatePattern() {
  const totalSec = 2.5; // extra tail for decay
  const n = Math.floor(SAMPLE_RATE * totalSec);
  const samples = new Float64Array(n);

  const hits = [
    { time: 0.0,  generator: generateKick,  label: 'kick' },
    { time: 0.5,  generator: generateHihat, label: 'hihat' },
    { time: 1.0,  generator: generateSnare, label: 'snare' },
    { time: 1.5,  generator: generateKick,  label: 'kick2' },
  ];

  for (const hit of hits) {
    const hitSamples = hit.generator(0.4);
    const startIdx = Math.floor(hit.time * SAMPLE_RATE);
    for (let i = 0; i < hitSamples.length && (startIdx + i) < n; i++) {
      samples[startIdx + i] += hitSamples[i];
    }
  }

  // Normalize to prevent clipping
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.95) {
    const scale = 0.95 / peak;
    for (let i = 0; i < n; i++) samples[i] *= scale;
  }

  return samples;
}

// --- Main ---

import { mkdirSync, existsSync } from 'fs';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

console.log('Generating deterministic test audio files...\n');
console.log('Expected classifications:');
console.log('  test-kick.wav    → BilabialPlosive');
console.log('  test-hihat.wav   → HihatNoise');
console.log('  test-snare.wav   → Click');
console.log('  test-hum.wav     → HumVoiced');
console.log('  test-pattern.wav → [BilabialPlosive, HihatNoise, Click, BilabialPlosive] @ ~120 BPM\n');

writeWav('test-kick.wav', generateKick(0.5));
writeWav('test-hihat.wav', generateHihat(0.3));
writeWav('test-snare.wav', generateSnare(0.3));
writeWav('test-hum.wav', generateHum(1.0));
writeWav('test-pattern.wav', generatePattern());

console.log('\nAll files written to test-audio/');
