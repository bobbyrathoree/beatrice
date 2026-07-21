// scheduleArrangement - Pure WebAudio synthesis + scheduling for an Arrangement.
//
// This module is the single source of truth for how Beatrice SOUNDS. It is
// deliberately free of React and of module-global state: every function takes
// its `ctx` (any BaseAudioContext — a live `AudioContext` for playback or an
// `OfflineAudioContext` for WAV export), its target `bus`/`destination`, and a
// `TimbreParams` snapshot explicitly. That is what lets the browser demo and the
// offline WAV renderer share identical, DETERMINISTIC synthesis code: every
// value comes from the timbre (Task 2), and every noise/IR buffer is seeded.
//
// Sound design philosophy: Every sound should have character and depth.
// - Kicks should feel like they hit your chest
// - Hi-hats should shimmer with metallic overtones
// - Snares should crack with body and noise
// - Bass should be warm with movement
// - Pads should breathe and evolve
// - Arps should pluck and sing

import { mulberry32, seedFrom } from "./timbre";
import type {
  TimbreParams,
  KickParams,
  SnareParams,
  HihatParams,
  PadParams,
  ArpParams,
  InstrumentKind,
} from "./timbre";

// ---- Types matching the Rust Arrangement serialized via serde ----

export interface ArrangedNote {
  timestamp_ms: number;
  duration_ms: number;
  velocity: number; // 0-127 MIDI velocity
  midi_note?: number; // Optional per-note MIDI override
  source_event_id: string | null;
}

export interface Lane {
  name: string;
  midi_note: number;
  events: ArrangedNote[];
}

// ---- Master FX bus ----

/**
 * Themed master FX bus. Instead of one shared `input`, every instrument connects
 * to its OWN unity-gain input node (`inputs[kind]`). Each input fans out to a dry
 * path (into a drum or music group) plus per-instrument delay/reverb/chorus sends
 * that feed shared FX returns. The whole graph is parameterized by `TimbreParams`
 * so each theme routes differently, and it is rebuilt fresh per render/playback
 * session (no module globals, no memoization).
 */
export interface FxBus {
  /** Unity-gain (1.0) input nodes; each instrument connects to its own. */
  inputs: Record<InstrumentKind, GainNode>;
  /**
   * Sidechain duck of the bass/pad/arp INPUT gains (pre-fan-out, so the dry AND
   * every wet send duck together — a single point of control). Kick never ducks
   * itself. Input gains return to 1.0 (they are unity inputs, NOT the 0.85 group
   * gain).
   */
  duck(time: number): void;
}

/** Convert MIDI velocity (0-127) to gain (0.0-1.0) with a musical curve */
export function velocityToGain(velocity: number): number {
  const linear = Math.max(0, Math.min(1, velocity / 127));
  // Slightly exponential curve for more musical dynamics
  return linear * linear * 0.8 + linear * 0.2;
}

/** Convert MIDI note number to frequency in Hz */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Create a white noise buffer whose contents are DETERMINISTIC for a given seed
 * (mulberry32). Same seed → same samples across renders and platforms.
 */
export function createNoiseBuffer(
  ctx: BaseAudioContext,
  durationSec: number,
  seed: number,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.ceil(sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const rand = mulberry32(seed);
  for (let i = 0; i < length; i++) {
    data[i] = rand() * 2 - 1;
  }
  return buffer;
}

/**
 * Create a synthesized STEREO impulse response for the reverb. Deterministic: the
 * two channels derive their own seeds INTERNALLY as `seedFrom("ir-ch", baseSeed,
 * channelIndex)` so L/R decorrelate from one base seed without sharing samples.
 *
 * When `gateSec` is provided, the IR is gated: samples in
 * `[gateSec - 0.015, gateSec]` are linearly faded to 0 (the fade ENDS exactly at
 * the gate), and every sample past `gateSec` is zero.
 */
export function createImpulseResponse(
  ctx: BaseAudioContext,
  duration: number,
  decay: number,
  baseSeed: number,
  gateSec: number | null = null,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const fadeSec = 0.015;

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    const rand = mulberry32(seedFrom("ir-ch", baseSeed, channel));
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sample = (rand() * 2 - 1) * Math.pow(1 - t / duration, decay);
      if (gateSec !== null) {
        if (t >= gateSec) {
          sample = 0;
        } else if (t >= gateSec - fadeSec) {
          // Linear fade to 0 ENDING at the gate: 1 at (gate-fade), 0 at gate.
          sample *= (gateSec - t) / fadeSec;
        }
      }
      data[i] = sample;
    }
  }
  return buffer;
}

/**
 * Soft-clip curve for the master limiter: unity slope for |x| ≤ L (so normal-
 * level mixes pass through untouched), then a smooth tanh saturation that caps
 * the output well below full scale. Values with |x| ≥ 1 are clamped by WebAudio
 * to the curve endpoints, so the ABSOLUTE output ceiling is `y(1)` — a hard
 * guarantee that the summed sends never reach ±1.0 and clip. Deterministic
 * (pure math, no randomness).
 */
function softClipCurve(samples = 2048): Float32Array<ArrayBuffer> {
  const L = 0.7; // linear region: |x| ≤ 0.7 → identity
  const ceil = 0.97; // tanh asymptote target
  const range = ceil - L;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1; // [-1, 1]
    const a = Math.abs(x);
    const y = a <= L ? a : L + range * Math.tanh((a - L) / range);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Build a fresh themed master FX graph on `ctx`, wired to `destination`. The
 * routing (groups, delay/reverb/chorus sends and returns, master headroom) comes
 * entirely from `timbre.fx`. FX graphs that a profile disables (delayTimeSec 0,
 * reverbDurationSec 0, chorus null) are simply not built and their sends are not
 * connected.
 */
export function createFxBus(
  ctx: BaseAudioContext,
  destination: AudioNode,
  timbre: TimbreParams,
): FxBus {
  const fx = timbre.fx;
  const now = ctx.currentTime;

  // Master → soft-clip guard → destination. Group gains (0.85) give summed-voice
  // headroom before the 0.8 master; the soft-clip is the final stage and caps the
  // fully-summed signal (all groups + FX returns) below full scale so a dense mix
  // can never clip.
  const clipGuard = ctx.createWaveShaper();
  clipGuard.curve = softClipCurve();
  clipGuard.connect(destination);

  const master = ctx.createGain();
  master.gain.setValueAtTime(fx.masterLevel, now);
  master.connect(clipGuard);

  const drumGroup = ctx.createGain();
  drumGroup.gain.setValueAtTime(0.85, now);
  drumGroup.connect(master);

  const musicGroup = ctx.createGain();
  musicGroup.gain.setValueAtTime(0.85, now);
  musicGroup.connect(master);

  // ---- Delay (skip the whole graph when delayTimeSec === 0) ----
  let delayInput: AudioNode | null = null;
  if (fx.delayTimeSec > 0) {
    // createDelay's arg is the MAXIMUM delay, not the current one — set the
    // current delayTime EXPLICITLY afterwards.
    const delay = ctx.createDelay(Math.max(1, fx.delayTimeSec * 1.5));
    delay.delayTime.setValueAtTime(fx.delayTimeSec, now);
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(fx.delayFeedback, now);
    if (fx.delayFilterHz !== null) {
      // Lowpass INSIDE the feedback loop: delay → filter → feedback → delay.
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(fx.delayFilterHz, now);
      delay.connect(lp);
      lp.connect(feedback);
    } else {
      delay.connect(feedback);
    }
    feedback.connect(delay);
    const delayReturn = ctx.createGain();
    delayReturn.gain.setValueAtTime(fx.delayReturn, now);
    delay.connect(delayReturn);
    delayReturn.connect(master);
    delayInput = delay;
  }

  // ---- Reverb (skip the whole graph when reverbDurationSec === 0) ----
  let reverbInput: AudioNode | null = null;
  if (fx.reverbDurationSec > 0) {
    const convolver = ctx.createConvolver();
    convolver.buffer = createImpulseResponse(
      ctx,
      fx.reverbDurationSec,
      fx.reverbDecay,
      seedFrom("ir", fx.profile),
      fx.reverbGateSec,
    );
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.setValueAtTime(fx.reverbReturn, now);
    convolver.connect(reverbReturn);
    reverbReturn.connect(master);
    reverbInput = convolver;
  }

  // ---- Chorus (WideChorus only) ----
  const chorusInputs: AudioNode[] = [];
  if (fx.chorus) {
    const c = fx.chorus;
    const chorusReturn = ctx.createGain();
    chorusReturn.gain.setValueAtTime(fx.chorusReturn, now);
    chorusReturn.connect(master);
    const makeSide = (delayMs: number, rateHz: number, pan: number) => {
      const d = ctx.createDelay(0.05);
      d.delayTime.setValueAtTime(Math.min(delayMs / 1000, 0.05), now);
      // Sine LFO → gain (±depthMs/1000) → delayTime for the chorus warble.
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(rateHz, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(c.depthMs / 1000, now);
      lfo.connect(lfoGain);
      lfoGain.connect(d.delayTime);
      lfo.start(now);
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, now);
      d.connect(panner);
      panner.connect(chorusReturn);
      chorusInputs.push(d);
    };
    makeSide(c.delayMsL, c.rateHzL, -0.7);
    makeSide(c.delayMsR, c.rateHzR, +0.7);
  }

  // ---- Input nodes + per-instrument fan-out ----
  const kinds: InstrumentKind[] = ["kick", "snare", "hihat", "bass", "pad", "arp"];
  const inputs = {} as Record<InstrumentKind, GainNode>;
  for (const k of kinds) {
    const input = ctx.createGain();
    input.gain.setValueAtTime(1.0, now); // unity: instruments connect here
    inputs[k] = input;

    const s = fx.sends[k];
    const group = k === "kick" || k === "snare" || k === "hihat" ? drumGroup : musicGroup;

    // Dry path → group (every profile has a dry send).
    const dry = ctx.createGain();
    dry.gain.setValueAtTime(s.dry, now);
    input.connect(dry);
    dry.connect(group);

    // Delay send.
    if (delayInput && s.delay > 0) {
      const ds = ctx.createGain();
      ds.gain.setValueAtTime(s.delay, now);
      input.connect(ds);
      ds.connect(delayInput);
    }
    // Reverb send.
    if (reverbInput && s.reverb > 0) {
      const rs = ctx.createGain();
      rs.gain.setValueAtTime(s.reverb, now);
      input.connect(rs);
      rs.connect(reverbInput);
    }
    // Chorus send (pad/arp only carry non-zero chorus).
    if (chorusInputs.length > 0 && s.chorus > 0) {
      const cs = ctx.createGain();
      cs.gain.setValueAtTime(s.chorus, now);
      input.connect(cs);
      for (const ci of chorusInputs) cs.connect(ci);
    }
  }

  const duck = (time: number): void => {
    for (const k of ["bass", "pad", "arp"] as InstrumentKind[]) {
      const g = inputs[k].gain;
      g.setTargetAtTime(0.3, time, 0.005);
      g.setTargetAtTime(1.0, time + 0.08, 0.05); // back to unity, not the group gain
    }
  };

  return { inputs, duck };
}

// ---- Individual instrument schedulers ----

export function scheduleKick(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  p: KickParams,
): void {
  const gain = velocityToGain(velocity);
  const dest = bus.inputs.kick;

  // === Layer 1: Sub-bass body (sine, pitch sweep) ===
  const subOsc = ctx.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.setValueAtTime(p.subFreqStartHz, time);
  subOsc.frequency.exponentialRampToValueAtTime(p.subFreqEndHz, time + p.sweepSec);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(gain * p.subLevel, time);
  subGain.gain.setValueAtTime(gain * p.subLevel, time + 0.02); // brief sustain
  subGain.gain.exponentialRampToValueAtTime(0.001, time + p.subDecaySec);

  subOsc.connect(subGain);
  subGain.connect(dest);
  subOsc.start(time);
  subOsc.stop(time + p.subDecaySec + 0.05);

  // === Layer 2: Click transient (triangle burst for attack definition) ===
  const clickOsc = ctx.createOscillator();
  clickOsc.type = "triangle";
  clickOsc.frequency.setValueAtTime(3500, time);
  clickOsc.frequency.exponentialRampToValueAtTime(200, time + 0.02);

  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(gain * p.clickLevel, time);
  clickGain.gain.exponentialRampToValueAtTime(0.001, time + p.clickDecaySec);

  clickOsc.connect(clickGain);
  clickGain.connect(dest);
  clickOsc.start(time);
  clickOsc.stop(time + p.clickDecaySec + 0.005);

  // === Layer 3: Harmonic warmth (slightly overdriven sine) — skipped when
  // harmLevel === 0 (e.g. the clean TR808 kick). ===
  if (p.harmLevel > 0) {
    const harmOsc = ctx.createOscillator();
    harmOsc.type = "sine";
    harmOsc.frequency.setValueAtTime(90, time);

    const waveshaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = Math.tanh(x * 2); // soft saturation
    }
    waveshaper.curve = curve;

    const harmGain = ctx.createGain();
    harmGain.gain.setValueAtTime(gain * p.harmLevel, time);
    harmGain.gain.exponentialRampToValueAtTime(0.001, time + p.harmDecaySec);

    harmOsc.connect(waveshaper);
    waveshaper.connect(harmGain);
    harmGain.connect(dest);
    harmOsc.start(time);
    harmOsc.stop(time + p.harmDecaySec + 0.05);
  }
}

export function scheduleSnare(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  p: SnareParams,
  seed: number,
): void {
  const gain = velocityToGain(velocity);
  const dest = bus.inputs.snare;

  // === Layer 1: Noise burst through bandpass (the "crack") ===
  const noiseBuffer = createNoiseBuffer(ctx, p.noiseDecaySec, seed);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(p.noiseBandpassStartHz, time);
  bandpass.frequency.exponentialRampToValueAtTime(p.noiseBandpassEndHz, time + 0.1);
  bandpass.Q.setValueAtTime(0.8, time);

  // Highpass to remove muddiness
  const hipass = ctx.createBiquadFilter();
  hipass.type = "highpass";
  hipass.frequency.setValueAtTime(p.noiseHipassHz, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain * p.noiseLevel, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.noiseDecaySec);

  noiseSrc.connect(bandpass);
  bandpass.connect(hipass);
  hipass.connect(noiseGain);
  noiseGain.connect(dest);

  // === Layer 2: Tonal body (triangle sweep) ===
  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = "triangle";
  bodyOsc.frequency.setValueAtTime(p.bodyFreqStartHz, time);
  bodyOsc.frequency.exponentialRampToValueAtTime(p.bodyFreqEndHz, time + 0.04);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(gain * p.bodyLevel, time);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, time + p.bodyDecaySec);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(dest);

  // === Layer 3: Ring / resonance (gives character) ===
  const ringOsc = ctx.createOscillator();
  ringOsc.type = "sine";
  ringOsc.frequency.setValueAtTime(p.ringFreqHz, time);

  const ringGain = ctx.createGain();
  ringGain.gain.setValueAtTime(gain * p.ringLevel, time);
  ringGain.gain.exponentialRampToValueAtTime(0.001, time + p.ringDecaySec);

  ringOsc.connect(ringGain);
  ringGain.connect(dest);

  noiseSrc.start(time);
  noiseSrc.stop(time + p.noiseDecaySec);
  bodyOsc.start(time);
  bodyOsc.stop(time + p.bodyDecaySec + 0.02);
  ringOsc.start(time);
  ringOsc.stop(time + p.ringDecaySec + 0.03);
}

export function scheduleHihat(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  p: HihatParams,
  seed: number,
): void {
  const gain = velocityToGain(velocity);
  const dest = bus.inputs.hihat;

  // === Metallic shimmer: multiple detuned square waves through highpass ===
  // metallicLevel is the TOTAL layer gain, so each oscillator gets an equal
  // slice (level / count); the velocity gain rides on the shared envelope node.
  const perOscGain = p.metallicLevel / p.metallicFreqsHz.length;
  const totalGainNode = ctx.createGain();
  totalGainNode.gain.setValueAtTime(gain, time);
  totalGainNode.gain.exponentialRampToValueAtTime(0.001, time + p.metallicDecaySec);

  const hipass = ctx.createBiquadFilter();
  hipass.type = "highpass";
  hipass.frequency.setValueAtTime(p.hipassHz, time);

  for (const freq of p.metallicFreqsHz) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, time);
    const og = ctx.createGain();
    og.gain.setValueAtTime(perOscGain, time);
    osc.connect(og);
    og.connect(totalGainNode);
    osc.start(time);
    osc.stop(time + p.metallicDecaySec + 0.02);
  }

  // === Noise layer for air ===
  const noiseBuffer = createNoiseBuffer(ctx, p.noiseDecaySec, seed);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const noiseHipass = ctx.createBiquadFilter();
  noiseHipass.type = "highpass";
  noiseHipass.frequency.setValueAtTime(p.noiseHipassHz, time);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain * p.noiseLevel, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + p.noiseDecaySec);

  totalGainNode.connect(hipass);
  hipass.connect(dest);

  noiseSrc.connect(noiseHipass);
  noiseHipass.connect(noiseGain);
  noiseGain.connect(dest);

  noiseSrc.start(time);
  noiseSrc.stop(time + p.noiseDecaySec);
}

export function scheduleBass(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  midiNote: number,
  durationMs: number,
): void {
  const gain = velocityToGain(velocity);
  const freq = midiToFreq(midiNote);
  const durSec = Math.max(0.05, durationMs / 1000);
  const dest = bus.inputs.bass;

  // Velocity to filter cutoff (The Growl)
  const velFactor = Math.pow(velocity / 127, 2); // Exponential mapping
  const filterOpen = freq * (2 + 6 * velFactor);
  const filterClose = freq * (1 + 1.5 * velFactor);

  // === Dual detuned sawtooth oscillators for width ===
  const osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.setValueAtTime(freq, time);

  const osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.frequency.setValueAtTime(freq * 1.005, time); // slight detune for warmth

  // === Sub oscillator (one octave down, sine for weight) ===
  const subOsc = ctx.createOscillator();
  subOsc.type = "sine";
  subOsc.frequency.setValueAtTime(freq / 2, time);

  // === Filter with envelope (the sweep that gives bass its character) ===
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterOpen, time); // open
  filter.frequency.exponentialRampToValueAtTime(filterClose, time + durSec * 0.6); // close
  filter.Q.setValueAtTime(2, time);

  // Amplitude envelope
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0.001, time);
  gainNode.gain.linearRampToValueAtTime(gain * 0.5, time + 0.008); // fast attack
  gainNode.gain.setValueAtTime(gain * 0.5, time + durSec * 0.7); // sustain
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + durSec); // release

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(gain * 0.3, time);
  subGain.gain.exponentialRampToValueAtTime(0.001, time + durSec);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(dest);

  subOsc.connect(subGain);
  subGain.connect(dest);

  osc1.start(time);
  osc1.stop(time + durSec + 0.05);
  osc2.start(time);
  osc2.stop(time + durSec + 0.05);
  subOsc.start(time);
  subOsc.stop(time + durSec + 0.05);
}

export function schedulePad(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  midiNote: number,
  durationMs: number,
  p: PadParams,
): void {
  const gain = velocityToGain(velocity);
  const freq = midiToFreq(midiNote);
  const durSec = Math.max(0.2, durationMs / 1000);
  const dest = bus.inputs.pad;

  // === Lush pad: 4 detuned oscillators with slow LFO modulation ===
  // Waveform/filter are FIXED; only the amplitude articulation changes with
  // pad_sustain (attack, decay depth, decay timing — from PadParams).
  const detunes = [-7, -3, 3, 7]; // cents of detuning for chorus effect
  const oscTypes: OscillatorType[] = ["sawtooth", "square", "sawtooth", "square"];

  const peak = gain * 0.22;
  const decayTarget = Math.max(0.001, peak * p.decayToLevel);

  const padBus = ctx.createGain();
  padBus.gain.setValueAtTime(0.001, time);
  padBus.gain.linearRampToValueAtTime(Math.max(0.001, peak), time + p.attackSec); // attack
  padBus.gain.exponentialRampToValueAtTime(decayTarget, time + durSec * p.decayByPortion); // decay (flat when sustained)
  padBus.gain.exponentialRampToValueAtTime(0.001, time + durSec); // release

  // Velocity to filter cutoff
  const velFactor = Math.pow(velocity / 127, 2);
  const padBaseFreq = 800 + 1000 * velFactor;
  const padSweepFreq = 1500 + 2000 * velFactor;

  // Slow filter sweep for movement
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
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
    lfo.type = "sine";
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
  padBus.connect(dest);
}

/**
 * ARP pluck voice (NEW): a single sawtooth through a resonant lowpass that sweeps
 * from `filterStartMul*noteFreq` down to `filterEndMul*noteFreq`, with a sharp
 * pluck envelope (fast attack, exponential decay). Bright, percussive, sequenced.
 */
export function scheduleArp(
  ctx: BaseAudioContext,
  bus: FxBus,
  time: number,
  velocity: number,
  midiNote: number,
  durationMs: number,
  p: ArpParams,
): void {
  const gain = velocityToGain(velocity);
  const freq = midiToFreq(midiNote);
  const durSec = Math.max(0.05, durationMs / 1000);
  const dest = bus.inputs.arp;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, time);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(p.filterStartMul * freq, time);
  filter.frequency.exponentialRampToValueAtTime(p.filterEndMul * freq, time + p.filterSweepSec);
  filter.Q.setValueAtTime(1, time);

  const decayEnd = Math.min(durSec, p.maxDecaySec);
  const level = Math.max(0.001, gain * p.level);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, time);
  g.gain.linearRampToValueAtTime(level, time + p.attackSec);
  g.gain.exponentialRampToValueAtTime(0.001, time + decayEnd);

  osc.connect(filter);
  filter.connect(g);
  g.connect(dest);

  osc.start(time);
  osc.stop(time + decayEnd + 0.02);
}

// ---- Instrument routing by lane name ----

function scheduleNote(
  ctx: BaseAudioContext,
  bus: FxBus,
  laneName: string,
  midiNote: number,
  note: ArrangedNote,
  startTime: number,
  timbre: TimbreParams,
  eventIndex: number,
): void {
  const noteTime = startTime + note.timestamp_ms / 1000;
  const name = laneName.toUpperCase();
  // Per-event seed for the seeded noise buffers (snare/hihat/fallback). Stable
  // across renders → deterministic output.
  const noiseSeed = seedFrom(laneName, eventIndex, "noise");

  if (name.includes("KICK")) {
    scheduleKick(ctx, bus, noteTime, note.velocity, timbre.kick);
    // The kick is the only voice that triggers the sidechain duck of the
    // bass/pad/arp inputs.
    bus.duck(noteTime);
  } else if (name.includes("SNARE") || name.includes("CLAP")) {
    scheduleSnare(ctx, bus, noteTime, note.velocity, timbre.snare, noiseSeed);
  } else if (name.includes("HIHAT") || name.includes("HAT")) {
    scheduleHihat(ctx, bus, noteTime, note.velocity, timbre.hihat, noiseSeed);
  } else if (name.includes("BASS")) {
    scheduleBass(ctx, bus, noteTime, note.velocity, midiNote, note.duration_ms);
  } else if (name.includes("ARP")) {
    scheduleArp(ctx, bus, noteTime, note.velocity, midiNote, note.duration_ms, timbre.arp);
  } else if (name.includes("PAD") || name.includes("SYNTH")) {
    schedulePad(ctx, bus, noteTime, note.velocity, midiNote, note.duration_ms, timbre.pad);
  } else {
    // Fallback: treat as a generic percussion hit.
    scheduleSnare(ctx, bus, noteTime, note.velocity, timbre.snare, noiseSeed);
  }
}

/**
 * Collect the playable lanes (those with events) from an arrangement. Supports
 * both the current shape (`drum_lanes` + `bass_lane`/`pad_lane`/`arp_lane`) and
 * the legacy `tracks` shape. Returns lanes in schedule order.
 */
export function collectArrangementLanes(arrangement: unknown): Lane[] {
  const arr = arrangement as Record<string, unknown>;
  const lanes: Lane[] = [];

  if (Array.isArray(arr.drum_lanes)) {
    const drumLanes = arr.drum_lanes as Lane[];
    for (const lane of drumLanes) {
      if (lane.events.length > 0) {
        lanes.push(lane);
      }
    }
    const bassLane = arr.bass_lane as Lane | null;
    if (bassLane && bassLane.events.length > 0) {
      lanes.push(bassLane);
    }
    const padLane = arr.pad_lane as Lane | null;
    if (padLane && padLane.events.length > 0) {
      lanes.push(padLane);
    }
    const arpLane = arr.arp_lane as Lane | null;
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
            if (e.event && typeof e.event === "object") {
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

  return lanes;
}

/**
 * Duration of an arrangement in seconds. Prefers the baked `total_duration_ms`,
 * falls back to the latest note end across lanes, then to `bar_count` at `bpm`.
 */
export function calculateArrangementDuration(arrangement: unknown, bpm: number): number {
  const arr = arrangement as Record<string, any>;
  let totalDurationMs = 0;

  if (typeof arr.total_duration_ms === "number" && arr.total_duration_ms > 0) {
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
    const barCount = typeof arr.bar_count === "number" ? arr.bar_count : 4;
    totalDurationMs = (barCount * 4 * 60 * 1000) / bpm;
  }

  return totalDurationMs / 1000; // Duration from arrangement (song structure is in the data)
}

/**
 * Schedule every note of an arrangement onto `bus` starting at `startTime`
 * (seconds, on `ctx`'s clock), synthesizing each voice with `timbre`. Song
 * structure (Intro/Build/Drop/Outro) is already baked into the arrangement by the
 * Rust arranger, so this simply dispatches each note to the matching instrument
 * synth. Returns the total duration of the arrangement in seconds.
 */
export function scheduleArrangement(
  ctx: BaseAudioContext,
  bus: FxBus,
  arrangement: unknown,
  startTime: number,
  timbre: TimbreParams,
): number {
  const lanes = collectArrangementLanes(arrangement);

  for (const lane of lanes) {
    lane.events.forEach((note, eventIndex) => {
      scheduleNote(
        ctx,
        bus,
        lane.name,
        note.midi_note ?? lane.midi_note,
        note,
        startTime,
        timbre,
        eventIndex,
      );
    });
  }

  return calculateArrangementDuration(arrangement, 120);
}
