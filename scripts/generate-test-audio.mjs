#!/usr/bin/env node
/**
 * Generate deterministic test WAV files for Beatrice pipeline verification.
 * 
 * Optimized for clean onset detection and sharp transients.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'test-audio');

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;
const NUM_CHANNELS = 1;

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function writeWav(filename, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(NUM_CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(BIT_DEPTH, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  const path = join(outDir, filename);
  writeFileSync(path, buf);
  return path;
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function generateKick(durationSec = 0.5) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const freq = t < 0.05 ? 150 - (90 * t / 0.05) : 60;
    const phase = 2 * Math.PI * freq * t;
    const envelope = Math.exp(-35 * t); // Super sharp decay
    samples[i] = Math.sin(phase) * envelope * 0.9;
  }
  return samples;
}

function generateHihat(durationSec = 0.3) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(42);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-40 * t);
    let signal = 0;
    for (let f = 6000; f <= 12000; f += 500) {
      signal += Math.sin(2 * Math.PI * f * t + rand() * Math.PI * 2) * 0.15;
    }
    signal += (rand() * 2 - 1) * 0.3;
    samples[i] = signal * envelope * 0.7;
  }
  return samples;
}

function generateSnare(durationSec = 0.3) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(123);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-45 * t);
    const body = (
      Math.sin(2 * Math.PI * 800 * t) * 0.35 +
      Math.sin(2 * Math.PI * 1200 * t) * 0.25 +
      Math.sin(2 * Math.PI * 1600 * t) * 0.15
    ) * Math.exp(-50 * t);
    let noise = 0;
    for (let f = 1000; f <= 2500; f += 250) {
      noise += Math.sin(2 * Math.PI * f * t + rand() * Math.PI * 2) * 0.06;
    }
    samples[i] = (body + noise * envelope) * 0.8;
  }
  return samples;
}

function generateHum(durationSec = 1.0) {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(n);
  const rand = seededRandom(456);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let envelope = t < 0.02 ? t / 0.02 : (t < durationSec - 0.1 ? 1.0 : (durationSec - t) / 0.1);
    const f0 = 300 * (1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t));
    let signal = Math.sin(2 * Math.PI * f0 * t) * 0.4 + 
                 Math.sin(2 * Math.PI * f0 * 2 * t) * 0.25 +
                 Math.sin(2 * Math.PI * f0 * 3 * t) * 0.15;
    signal += (rand() * 2 - 1) * 0.06;
    samples[i] = signal * envelope * 0.7;
  }
  return samples;
}

function generate8BarProgression() {
  const bpm = 120;
  const beatMs = 60000 / bpm;
  const totalBars = 8;
  const totalSec = (beatMs * 4 * totalBars + 500) / 1000;
  const n = Math.floor(SAMPLE_RATE * totalSec);
  const samples = new Float64Array(n);

  for (let bar = 0; bar < totalBars; bar++) {
    const barOffset = bar * beatMs * 4;
    // Kick on 1, Snare on 2, Kick on 3, Snare on 4
    addHit(samples, barOffset + 0 * beatMs, generateKick, 0.1);
    addHit(samples, barOffset + 1 * beatMs, generateSnare, 0.1);
    addHit(samples, barOffset + 2 * beatMs, generateKick, 0.1);
    addHit(samples, barOffset + 3 * beatMs, generateSnare, 0.1);

    // Hihats on all offbeats (8ths)
    for (let beat = 0; beat < 4; beat++) {
      addHit(samples, barOffset + beat * beatMs + beatMs / 2, generateHihat, 0.05);
    }

    // Hum at start of every 2-bar cycle
    if (bar % 2 === 0) {
      addHit(samples, barOffset, generateHum, 1.0);
    }
  }

  normalize(samples);
  return samples;
}

function addHit(buffer, timeMs, gen, dur) {
  const hitSamples = gen(dur);
  const startIdx = Math.floor(timeMs * SAMPLE_RATE / 1000);
  for (let i = 0; i < hitSamples.length && (startIdx + i) < buffer.length; i++) {
    buffer[startIdx + i] += hitSamples[i];
  }
}

function normalize(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0.9) {
    const scale = 0.9 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
}

console.log('Generating tightened test audio...');
writeWav('test-kick.wav', generateKick(0.2));
writeWav('test-hihat.wav', generateHihat(0.1));
writeWav('test-snare.wav', generateSnare(0.1));
writeWav('test-hum.wav', generateHum(1.0));
writeWav('test-8bar-progression.wav', generate8BarProgression());
console.log('Done.');
