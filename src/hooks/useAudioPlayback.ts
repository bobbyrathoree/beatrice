// useAudioPlayback - WebAudio synthesis for in-app arrangement playback
//
// Synthesizes kick, snare, hi-hat, bass, and pad sounds using the Web Audio API.
// Schedules all notes from an Arrangement and tracks playback progress.
//
// Sound design philosophy: Every sound should have character and depth.
// - Kicks should feel like they hit your chest
// - Hi-hats should shimmer with metallic overtones
// - Snares should crack with body and noise
// - Bass should be warm with movement
// - Pads should breathe and evolve

import { useState, useRef, useCallback, useEffect } from 'react';

// ---- Types matching the Rust Arrangement serialized via serde ----

interface ArrangedNote {
  timestamp_ms: number;
  duration_ms: number;
  velocity: number; // 0-127 MIDI velocity
  midi_note?: number; // Optional per-note MIDI override
  source_event_id: string | null;
}

interface DrumLane {
  name: string;
  midi_note: number;
  events: ArrangedNote[];
}

// ---- Synthesis helpers ----

/** Convert MIDI velocity (0-127) to gain (0.0-1.0) with a musical curve */
function velocityToGain(velocity: number): number {
  const linear = Math.max(0, Math.min(1, velocity / 127));
  // Slightly exponential curve for more musical dynamics
  return linear * linear * 0.8 + linear * 0.2;
}

/** Convert MIDI note number to frequency in Hz */
function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Create a white noise buffer */
function createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.ceil(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// ---- Master FX Chain (Reverb and Delay) ----

let masterGain: GainNode | null = null;
let reverbNode: ConvolverNode | null = null;
let delayNode: DelayNode | null = null;
let delayFeedback: GainNode | null = null;

/** Create a synthesized impulse response for the reverb */
function createImpulseResponse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / duration, decay);
    }
  }
  return buffer;
}

function getMasterBus(ctx: AudioContext): GainNode {
  if (!masterGain || masterGain.context !== ctx) {
    // 1. Master Gain (Sidechain target)
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, ctx.currentTime);

    // 2. Stereo Delay
    delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.setValueAtTime(0.375, ctx.currentTime); // 1/8th dot approx at 120bpm
    
    delayFeedback = ctx.createGain();
    delayFeedback.gain.setValueAtTime(0.3, ctx.currentTime);
    
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    // 3. Cinematic Reverb
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = createImpulseResponse(ctx, 3.0, 2.5);

    const reverbGain = ctx.createGain();
    reverbGain.gain.setValueAtTime(0.2, ctx.currentTime);

    // 4. Routing: Master -> Destination (Dry)
    //           Master -> Delay -> Destination (Wet)
    //           Master -> Reverb -> Destination (Wet)
    masterGain.connect(ctx.destination);
    
    masterGain.connect(delayNode);
    delayNode.connect(ctx.destination);
    
    masterGain.connect(reverbNode);
    reverbNode.connect(reverbGain);
    reverbGain.connect(ctx.destination);
  }
  return masterGain;
}

function scheduleSidechainDuck(ctx: AudioContext, time: number) {
  const master = getMasterBus(ctx);
  // Pumping effect — ducks everything *before* it hits reverb
  master.gain.setTargetAtTime(0.3, time, 0.005);
  master.gain.setTargetAtTime(0.85, time + 0.08, 0.05);
}

// ---- Individual instrument schedulers ----

function scheduleKick(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);
  const master = getMasterBus(ctx);

  // === Layer 1: Sub-bass body (sine, 150→45Hz pitch sweep) ===
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(150, time);
  subOsc.frequency.exponentialRampToValueAtTime(45, time + 0.08);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(gain * 0.9, time);
  subGain.gain.setValueAtTime(gain * 0.9, time + 0.02);  // brief sustain
  subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

  subOsc.connect(subGain);
  subGain.connect(master);
  subOsc.start(time);
  subOsc.stop(time + 0.45);

  // === Layer 2: Click transient (triangle burst for attack definition) ===
  const clickOsc = ctx.createOscillator();
  clickOsc.type = 'triangle';
  clickOsc.frequency.setValueAtTime(3500, time);
  clickOsc.frequency.exponentialRampToValueAtTime(200, time + 0.02);

  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(gain * 0.35, time);
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

  clickOsc.connect(clickGain);
  clickGain.connect(master);
  clickOsc.start(time);
  clickOsc.stop(time + 0.03);

  // === Layer 3: Harmonic warmth (slightly overdriven sine) ===
  const harmOsc = ctx.createOscillator();
  harmOsc.type = 'sine';
  harmOsc.frequency.setValueAtTime(90, time);

  const waveshaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128) - 1;
    curve[i] = Math.tanh(x * 2); // soft saturation
  }
  waveshaper.curve = curve;

  const harmGain = ctx.createGain();
  harmGain.gain.setValueAtTime(gain * 0.2, time);
  harmGain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

  harmOsc.connect(waveshaper);
  waveshaper.connect(harmGain);
  harmGain.connect(master);
  harmOsc.start(time);
  harmOsc.stop(time + 0.3);

  // Trigger sidechain duck on the master bus
  scheduleSidechainDuck(ctx, time);
}

function scheduleSnare(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);
  const master = getMasterBus(ctx);

  // === Layer 1: Noise burst through bandpass (the "crack") ===
  const noiseBuffer = createNoiseBuffer(ctx, 0.2);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(3500, time);
  bandpass.frequency.exponentialRampToValueAtTime(2000, time + 0.1);
  bandpass.Q.setValueAtTime(0.8, time);

  // Highpass to remove muddiness
  const hipass = ctx.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.setValueAtTime(200, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.65, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

  noiseSrc.connect(bandpass);
  bandpass.connect(hipass);
  hipass.connect(noiseGain);
  noiseGain.connect(master);

  // === Layer 2: Tonal body (sine + triangle at ~200Hz) ===
  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'triangle';
  bodyOsc.frequency.setValueAtTime(220, time);
  bodyOsc.frequency.exponentialRampToValueAtTime(120, time + 0.04);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(gain * 0.5, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(master);

  // === Layer 3: Ring / resonance (gives character) ===
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'sine';
  ringOsc.frequency.setValueAtTime(180, time);

  const ringGain = ctx.createGain();
  ringGain.gain.setValueAtTime(gain * 0.12, time);
  ringGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

  ringOsc.connect(ringGain);
  ringGain.connect(master);

  noiseSrc.start(time);
  noiseSrc.stop(time + 0.2);
  bodyOsc.start(time);
  bodyOsc.stop(time + 0.1);
  ringOsc.start(time);
  ringOsc.stop(time + 0.15);
}

function scheduleHihat(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);
  const master = getMasterBus(ctx);

  // === Metallic shimmer: multiple detuned square waves through highpass ===
  // Real hi-hats are metal discs vibrating at inharmonic frequencies
  const metallicFreqs = [3742, 4835, 5917, 7264, 8476];
  const totalGainNode = ctx.createGain();
  totalGainNode.gain.setValueAtTime(gain * 0.3, time);
  totalGainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

  const hipass = ctx.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.setValueAtTime(7000, time);

  for (const freq of metallicFreqs) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(totalGainNode);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  // === Noise layer for air ===
  const noiseBuffer = createNoiseBuffer(ctx, 0.06);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const noiseHipass = ctx.createBiquadFilter();
  noiseHipass.type = 'highpass';
  noiseHipass.frequency.setValueAtTime(9000, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.25, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

  totalGainNode.connect(hipass);
  hipass.connect(master);

  noiseSrc.connect(noiseHipass);
  noiseHipass.connect(noiseGain);
  noiseGain.connect(master);

  noiseSrc.start(time);
  noiseSrc.stop(time + 0.06);
}

function scheduleBass(
  ctx: AudioContext,
  time: number,
  velocity: number,
  midiNote: number,
  durationMs: number,
): void {
  const gain = velocityToGain(velocity);
  const freq = midiToFreq(midiNote);
  const durSec = Math.max(0.05, durationMs / 1000);
  const master = getMasterBus(ctx);

  // Velocity to filter cutoff (The Growl)
  const velFactor = Math.pow(velocity / 127, 2); // Exponential mapping
  const filterOpen = freq * (2 + 6 * velFactor);
  const filterClose = freq * (1 + 1.5 * velFactor);

  // === Dual detuned sawtooth oscillators for width ===
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(freq, time);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 1.005, time); // slight detune for warmth

  // === Sub oscillator (one octave down, sine for weight) ===
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(freq / 2, time);

  // === Filter with envelope (the sweep that gives bass its character) ===
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterOpen, time);      // open
  filter.frequency.exponentialRampToValueAtTime(filterClose, time + durSec * 0.6); // close
  filter.Q.setValueAtTime(2, time);

  // Amplitude envelope
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.001, time);
  gainNode.gain.linearRampToValueAtTime(gain * 0.5, time + 0.008);  // fast attack
  gainNode.gain.setValueAtTime(gain * 0.5, time + durSec * 0.7);    // sustain
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + durSec);  // release

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(gain * 0.3, time);
  subGain.gain.exponentialRampToValueAtTime(0.001, time + durSec);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(master);

  subOsc.connect(subGain);
  subGain.connect(master);

  osc1.start(time);
  osc1.stop(time + durSec + 0.05);
  osc2.start(time);
  osc2.stop(time + durSec + 0.05);
  subOsc.start(time);
  subOsc.stop(time + durSec + 0.05);
}

function schedulePad(
  ctx: AudioContext,
  time: number,
  velocity: number,
  midiNote: number,
  durationMs: number,
): void {
  const gain = velocityToGain(velocity);
  const freq = midiToFreq(midiNote);
  const durSec = Math.max(0.2, durationMs / 1000);
  const master = getMasterBus(ctx);

  // === Lush pad: 4 detuned oscillators with slow LFO modulation ===
  const detunes = [-7, -3, 3, 7]; // cents of detuning for chorus effect
  const oscTypes: OscillatorType[] = ['sawtooth', 'square', 'sawtooth', 'square'];

  const padBus = ctx.createGain();
  padBus.gain.setValueAtTime(0.001, time);
  padBus.gain.linearRampToValueAtTime(gain * 0.22, time + 0.15);    // slow attack
  padBus.gain.setValueAtTime(gain * 0.22, time + durSec * 0.8);     // sustain
  padBus.gain.exponentialRampToValueAtTime(0.001, time + durSec);    // release

  // Velocity to filter cutoff
  const velFactor = Math.pow(velocity / 127, 2);
  const padBaseFreq = 800 + 1000 * velFactor;
  const padSweepFreq = 1500 + 2000 * velFactor;

  // Slow filter sweep for movement
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.setValueAtTime(padSweepFreq, time);
  padFilter.frequency.linearRampToValueAtTime(padBaseFreq, time + durSec * 0.5);
  padFilter.frequency.linearRampToValueAtTime(padBaseFreq * 1.5, time + durSec);
  padFilter.Q.setValueAtTime(1.5, time);

  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator();
    osc.type = oscTypes[i];
    osc.frequency.setValueAtTime(freq, time);
    osc.detune.setValueAtTime(detunes[i], time);

    // Slow vibrato via LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.3 + i * 0.15, time); // slightly different rates
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(3 + i, time); // subtle pitch wobble in cents

    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);

    osc.connect(padFilter);
    lfo.start(time);
    lfo.stop(time + durSec + 0.1);
    osc.start(time);
    osc.stop(time + durSec + 0.1);
  }

  padFilter.connect(padBus);
  padBus.connect(master);
}

// ---- Instrument routing by lane name ----

function scheduleNote(
  ctx: AudioContext,
  laneName: string,
  midiNote: number,
  note: ArrangedNote,
  startTime: number,
): void {
  const noteTime = startTime + note.timestamp_ms / 1000;
  const name = laneName.toUpperCase();

  if (name.includes('KICK')) {
    scheduleKick(ctx, noteTime, note.velocity);
  } else if (name.includes('SNARE') || name.includes('CLAP')) {
    scheduleSnare(ctx, noteTime, note.velocity);
  } else if (name.includes('HIHAT') || name.includes('HAT')) {
    scheduleHihat(ctx, noteTime, note.velocity);
  } else if (name.includes('BASS')) {
    scheduleBass(ctx, noteTime, note.velocity, midiNote, note.duration_ms);
  } else if (name.includes('PAD') || name.includes('ARP') || name.includes('SYNTH')) {
    schedulePad(ctx, noteTime, note.velocity, midiNote, note.duration_ms);
  } else {
    // Fallback: treat as a generic percussion hit
    scheduleSnare(ctx, noteTime, note.velocity);
  }
}

// ---- Main hook ----

function calculateArrangementDuration(arrangement: any, bpm: number): number {
  const arr = arrangement as Record<string, any>;
  let totalDurationMs = 0;

  if (typeof arr.total_duration_ms === 'number' && arr.total_duration_ms > 0) {
    totalDurationMs = arr.total_duration_ms;
  } else {
    // Fallback to searching lanes
    const checkLanes = (lane: any) => {
      if (!lane || !Array.isArray(lane.events)) return;
      for (const note of lane.events) {
        const endMs = note.timestamp_ms + note.duration_ms;
        if (endMs > totalDurationMs) totalDurationMs = endMs;
      }
    };

    if (Array.isArray(arr.drum_lanes)) arr.drum_lanes.forEach(checkLanes);
    checkLanes(arr.bass_lane);
    checkLanes(arr.pad_lane);
    checkLanes(arr.arp_lane);
  }

  if (totalDurationMs <= 0) {
    const barCount = typeof arr.bar_count === 'number' ? arr.bar_count : 4;
    totalDurationMs = (barCount * 4 * 60 * 1000) / bpm;
  }

  return totalDurationMs / 1000; // Duration from arrangement (song structure is in the data)
}

export function useAudioPlayback(initialArrangement?: any, initialBpm?: number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const durationRef = useRef<number>(0);

  // Update duration when arrangement or BPM changes
  useEffect(() => {
    if (initialArrangement) {
      const dur = calculateArrangementDuration(initialArrangement, initialBpm || 120);
      setDuration(dur);
      durationRef.current = dur;
    }
  }, [initialArrangement, initialBpm]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);

  // Tick function to update currentTime during playback
  const tick = useCallback(() => {
    if (!ctxRef.current || !isPlaying) return;

    const elapsed = ctxRef.current.currentTime - playStartRef.current;
    if (elapsed >= durationRef.current) {
      setCurrentTime(durationRef.current);
      setIsPlaying(false);
      return;
    }

    setCurrentTime(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  }, [isPlaying]);

  // Start the animation frame loop when playing
  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, tick]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    masterGain = null;
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const play = useCallback((arrangement: unknown, bpm: number) => {
    // Stop any existing playback first
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    masterGain = null;

    // Interpret the arrangement
    const arr = arrangement as Record<string, unknown>;
    const lanes: Array<{ name: string; midi_note: number; events: ArrangedNote[] }> = [];

    if (Array.isArray(arr.drum_lanes)) {
      const drumLanes = arr.drum_lanes as DrumLane[];
      for (const lane of drumLanes) {
        if (lane.events.length > 0) {
          lanes.push(lane);
        }
      }
      const bassLane = arr.bass_lane as DrumLane | null;
      if (bassLane && bassLane.events.length > 0) {
        lanes.push(bassLane);
      }
      const padLane = arr.pad_lane as DrumLane | null;
      if (padLane && padLane.events.length > 0) {
        lanes.push(padLane);
      }
      const arpLane = arr.arp_lane as DrumLane | null;
      if (arpLane && arpLane.events.length > 0) {
        lanes.push(arpLane);
      }
    } else if (Array.isArray(arr.tracks)) {
      const tracks = arr.tracks as Array<{ name: string; events: unknown[] }>;
      for (const track of tracks) {
        if (track.events.length > 0) {
          lanes.push({
            name: track.name,
            midi_note: 36,
            events: track.events.map((ev: unknown) => {
              const e = ev as Record<string, unknown>;
              if (e.event && typeof e.event === 'object') {
                const inner = e.event as Record<string, unknown>;
                return {
                  timestamp_ms: (e.quantized_timestamp_ms as number) ?? (inner.timestamp_ms as number) ?? 0,
                  duration_ms: (inner.duration_ms as number) ?? 100,
                  velocity: 100,
                  source_event_id: null,
                };
              }
              return {
                timestamp_ms: (e.timestamp_ms as number) ?? 0,
                duration_ms: (e.duration_ms as number) ?? 100,
                velocity: (e.velocity as number) ?? 100,
                source_event_id: null,
              };
            }),
          });
        }
      }
    }

    if (lanes.length === 0) {
      console.warn('useAudioPlayback: no lanes with events found in arrangement');
      return;
    }

    const songDurationSec = calculateArrangementDuration(arr, bpm);

    durationRef.current = songDurationSec;
    setDuration(songDurationSec);

    // Create a fresh AudioContext
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Initialize master bus
    getMasterBus(ctx);

    // Schedule all notes directly — song structure (Intro/Build/Drop/Outro)
    // is already baked into the arrangement by the Rust arranger
    const startTime = ctx.currentTime + 0.05;
    playStartRef.current = startTime;

    for (const lane of lanes) {
      for (const note of lane.events) {
        scheduleNote(
          ctx,
          lane.name,
          note.midi_note ?? lane.midi_note,
          note,
          startTime
        );
      }
    }

    setCurrentTime(0);
    setIsPlaying(true);
  }, []);

  return {
    isPlaying,
    currentTime,
    duration,
    play,
    stop,
  };
}
