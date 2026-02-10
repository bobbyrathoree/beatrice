// useAudioPlayback - WebAudio synthesis for in-app arrangement playback
//
// Synthesizes kick, snare, hi-hat, bass, and pad sounds using the Web Audio API.
// Schedules all notes from an Arrangement and tracks playback progress.

import { useState, useRef, useCallback, useEffect } from 'react';

// ---- Types matching the Rust Arrangement serialized via serde ----

interface ArrangedNote {
  timestamp_ms: number;
  duration_ms: number;
  velocity: number; // 0-127 MIDI velocity
  source_event_id: string | null;
}

interface DrumLane {
  name: string;
  midi_note: number;
  events: ArrangedNote[];
}

// The Rust Arrangement struct serializes (via serde) with fields:
//   drum_lanes: DrumLane[], bass_lane: DrumLane|null, pad_lane: DrumLane|null,
//   arp_lane: DrumLane|null, template: string, total_duration_ms: number,
//   bar_count: number
// The App.tsx simplified Arrangement uses: tracks: Array<{ name, events }>
// The play() function handles both shapes via Record<string, unknown>.

// ---- Synthesis helpers ----

/** Convert MIDI velocity (0-127) to gain (0.0-1.0) */
function velocityToGain(velocity: number): number {
  return Math.max(0, Math.min(1, velocity / 127));
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

// ---- Individual instrument schedulers ----

function scheduleKick(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);

  // Sine oscillator: 150Hz -> 60Hz sweep
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(60, time + 0.05);

  // Gain envelope: fast attack, exponential decay
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + 0.35);
}

function scheduleSnare(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);

  // Noise component through bandpass
  const noiseBuffer = createNoiseBuffer(ctx, 0.2);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(2000, time);
  bandpass.Q.setValueAtTime(1, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain * 0.8, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

  noiseSrc.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  // Sine body at 200Hz
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, time);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(gain * 0.5, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

  osc.connect(bodyGain);
  bodyGain.connect(ctx.destination);

  noiseSrc.start(time);
  noiseSrc.stop(time + 0.2);
  osc.start(time);
  osc.stop(time + 0.15);
}

function scheduleHihat(
  ctx: AudioContext,
  time: number,
  velocity: number,
): void {
  const gain = velocityToGain(velocity);

  // White noise through highpass
  const noiseBuffer = createNoiseBuffer(ctx, 0.08);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(8000, time);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain * 0.4, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

  noiseSrc.connect(highpass);
  highpass.connect(gainNode);
  gainNode.connect(ctx.destination);

  noiseSrc.start(time);
  noiseSrc.stop(time + 0.08);
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

  // Sawtooth oscillator
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, time);

  // Lowpass filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(800, time);
  filter.Q.setValueAtTime(1, time);

  // Gain envelope
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain * 0.6, time);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + Math.min(durSec, 0.3));

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + durSec + 0.05);
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
  const durSec = Math.max(0.1, durationMs / 1000);

  // Square wave
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, time);

  // Lowpass filter with envelope
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, time);
  filter.frequency.exponentialRampToValueAtTime(400, time + durSec * 0.8);
  filter.Q.setValueAtTime(2, time);

  // Gain envelope with sustain
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.001, time);
  gainNode.gain.linearRampToValueAtTime(gain * 0.35, time + 0.02); // fast attack
  gainNode.gain.setValueAtTime(gain * 0.35, time + durSec * 0.6);  // sustain
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + durSec); // release

  osc.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + durSec + 0.05);
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
    // Fallback: treat as a generic percussion hit (snare-like)
    scheduleSnare(ctx, noteTime, note.velocity);
  }
}

// ---- Main hook ----

export function useAudioPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const durationRef = useRef<number>(0);

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
      // Playback finished naturally
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
    // Cancel animation frame
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Close and discard context to stop all scheduled audio
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }

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

    // Interpret the arrangement
    // The arrangement may come as either the Rust-serialized format or the
    // simplified TS format used in App.tsx. Handle both.
    const arr = arrangement as Record<string, unknown>;
    const lanes: Array<{ name: string; midi_note: number; events: ArrangedNote[] }> = [];

    if (Array.isArray(arr.drum_lanes)) {
      // Rust serde format
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
      // Simplified TS format from App.tsx Arrangement interface
      const tracks = arr.tracks as Array<{ name: string; events: unknown[] }>;
      for (const track of tracks) {
        if (track.events.length > 0) {
          lanes.push({
            name: track.name,
            midi_note: 36, // default
            events: track.events.map((ev: unknown) => {
              const e = ev as Record<string, unknown>;
              // Handle both QuantizedEvent (nested) and direct ArrangedNote shapes
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

    // Calculate total duration from arrangement or BPM
    let totalDurationMs = 0;
    if (typeof arr.total_duration_ms === 'number') {
      totalDurationMs = arr.total_duration_ms;
    }
    if (totalDurationMs <= 0) {
      // Fallback: find the latest note end time
      for (const lane of lanes) {
        for (const note of lane.events) {
          const endMs = note.timestamp_ms + note.duration_ms;
          if (endMs > totalDurationMs) {
            totalDurationMs = endMs;
          }
        }
      }
    }
    if (totalDurationMs <= 0) {
      // Last resort: use bar_count and bpm
      const barCount = typeof arr.bar_count === 'number'
        ? arr.bar_count
        : 4;
      totalDurationMs = (barCount * 4 * 60 * 1000) / bpm;
    }

    const totalDurationSec = totalDurationMs / 1000;
    durationRef.current = totalDurationSec;
    setDuration(totalDurationSec);

    // Create a fresh AudioContext
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    // Handle browser autoplay policy
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // Schedule all notes
    const startTime = ctx.currentTime + 0.05; // small buffer
    playStartRef.current = startTime;

    for (const lane of lanes) {
      for (const note of lane.events) {
        scheduleNote(ctx, lane.name, lane.midi_note, note, startTime);
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
