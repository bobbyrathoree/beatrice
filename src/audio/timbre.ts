// timbre.ts — the pure adapter mapping a theme's semantic ThemeSound (drum
// palette + FX profile + pad articulation) to concrete DSP parameters, plus a
// seeded PRNG. This is the SINGLE source of truth for "what a theme sounds
// like"; the synth (Task 3) consumes TimbreParams and never re-derives values.
//
// deriveTimbre is PURE (no logging, no side effects). All impurity — runtime
// validation of untrusted/legacy arrangement metadata — lives in
// renderMetaFromArrangement.
import type { ThemeSound, DrumPalette, FxProfile } from "../bindings";

export type InstrumentKind = "kick" | "snare" | "hihat" | "bass" | "pad" | "arp";

export interface SendLevels {
  dry: number;
  delay: number;
  reverb: number;
  chorus: number;
}

export interface KickParams {
  subFreqStartHz: number;
  subFreqEndHz: number;
  sweepSec: number;
  subLevel: number;
  subDecaySec: number;
  clickLevel: number;
  clickDecaySec: number;
  harmLevel: number;
  harmDecaySec: number; // 0 level = layer skipped
}

export interface SnareParams {
  noiseBandpassStartHz: number;
  noiseBandpassEndHz: number;
  noiseHipassHz: number;
  noiseLevel: number;
  noiseDecaySec: number;
  bodyFreqStartHz: number;
  bodyFreqEndHz: number;
  bodyLevel: number;
  bodyDecaySec: number;
  ringFreqHz: number;
  ringLevel: number;
  ringDecaySec: number;
}

export interface HihatParams {
  metallicFreqsHz: number[];
  metallicLevel: number; // TOTAL layer gain — divide by metallicFreqsHz.length per oscillator
  metallicDecaySec: number;
  hipassHz: number;
  noiseHipassHz: number;
  noiseLevel: number;
  noiseDecaySec: number;
}

export interface PadParams {
  sustain: boolean; // articulation only — no waveform change
  attackSec: number; // sustained: 0.15 | rhythmic: 0.01
  decayToLevel: number; // sustained: 1.0 (no decay stage) | rhythmic: 0.2
  decayByPortion: number; // rhythmic: decay completes by this fraction of duration (0.4)
}

export interface ArpParams {
  level: number;
  attackSec: number;
  maxDecaySec: number;
  filterStartMul: number;
  filterEndMul: number;
  filterSweepSec: number;
}

export interface FxParams {
  profile: FxProfile;
  delayTimeSec: number; // resolved against bpm (see table); 0 = no delay graph
  delayFeedback: number;
  delayFilterHz: number | null; // lowpass INSIDE the feedback loop; null = none
  reverbDurationSec: number; // 0 = no reverb graph
  reverbDecay: number;
  reverbGateSec: number | null; // IR truncated at this length; 15ms fade ENDING at the gate
  chorus: null | {
    delayMsL: number;
    delayMsR: number;
    depthMs: number;
    rateHzL: number;
    rateHzR: number;
  };
  sends: Record<InstrumentKind, SendLevels>;
  delayReturn: number; // 0.6
  reverbReturn: number; // 0.7
  chorusReturn: number; // 1.0 (chorus level lives in the pad/arp `chorus` sends)
  masterLevel: number; // 0.8 headroom
  renderTailSec: number; // dry-voice overhang + FX ring-out + 0.1 (see formula)
}

export interface TimbreParams {
  kick: KickParams;
  snare: SnareParams;
  hihat: HihatParams;
  pad: PadParams;
  arp: ArpParams;
  fx: FxParams;
}

/** BLADE RUNNER's sound — the documented default for legacy/missing metadata. */
export const DEFAULT_SOUND: ThemeSound = {
  drum_palette: "SynthwaveDrums",
  fx_profile: "GatedReverb",
  pad_sustain: true,
};

// ─── Drum palettes ──────────────────────────────────────────────────────────
// EXPANDABILITY CONTRACT: this Record is keyed by the generated `DrumPalette`
// binding enum. Add a variant in Rust, regenerate bindings, and tsc will FAIL
// here until the new palette is given a DSP mapping — sound design can never
// silently fall through to a default.
const DRUMS: Record<DrumPalette, Pick<TimbreParams, "kick" | "snare" | "hihat">> = {
  SynthwaveDrums: {
    // current Beatrice kit, values verbatim from scheduleArrangement.ts today
    kick: {
      subFreqStartHz: 150,
      subFreqEndHz: 45,
      sweepSec: 0.08,
      subLevel: 0.9,
      subDecaySec: 0.4,
      clickLevel: 0.35,
      clickDecaySec: 0.025,
      harmLevel: 0.2,
      harmDecaySec: 0.25,
    },
    snare: {
      noiseBandpassStartHz: 3500,
      noiseBandpassEndHz: 2000,
      noiseHipassHz: 200,
      noiseLevel: 0.65,
      noiseDecaySec: 0.18,
      bodyFreqStartHz: 220,
      bodyFreqEndHz: 120,
      bodyLevel: 0.5,
      bodyDecaySec: 0.08,
      ringFreqHz: 180,
      ringLevel: 0.12,
      ringDecaySec: 0.12,
    },
    hihat: {
      metallicFreqsHz: [3742, 4835, 5917, 7264, 8476],
      metallicLevel: 0.3,
      metallicDecaySec: 0.06,
      hipassHz: 7000,
      noiseHipassHz: 9000,
      noiseLevel: 0.25,
      noiseDecaySec: 0.04,
    },
  },
  TR808: {
    kick: {
      subFreqStartHz: 140,
      subFreqEndHz: 50,
      sweepSec: 0.06,
      subLevel: 1.0,
      subDecaySec: 0.7,
      clickLevel: 0.1,
      clickDecaySec: 0.015,
      harmLevel: 0.0,
      harmDecaySec: 0.0,
    },
    snare: {
      noiseBandpassStartHz: 5000,
      noiseBandpassEndHz: 4000,
      noiseHipassHz: 800,
      noiseLevel: 0.8,
      noiseDecaySec: 0.16,
      bodyFreqStartHz: 185,
      bodyFreqEndHz: 175,
      bodyLevel: 0.35,
      bodyDecaySec: 0.1,
      ringFreqHz: 330,
      ringLevel: 0.2,
      ringDecaySec: 0.12,
    },
    hihat: {
      metallicFreqsHz: [3600, 5200, 6800, 8100, 9500, 10500],
      metallicLevel: 0.35,
      metallicDecaySec: 0.035,
      hipassHz: 8000,
      noiseHipassHz: 10000,
      noiseLevel: 0.15,
      noiseDecaySec: 0.025,
    },
  },
};

/** An FxProfile entry minus the derived renderTailSec (computed in deriveTimbre). */
type FxBase = Omit<FxParams, "renderTailSec">;

/** Dry send for a single voice — no wet routing. */
const DRY_SEND: SendLevels = { dry: 1, delay: 0, reverb: 0, chorus: 0 };

// ─── FX profiles ────────────────────────────────────────────────────────────
// EXPANDABILITY CONTRACT: keyed by the generated `FxProfile` binding enum. A new
// profile added in Rust breaks tsc here until it is given a full routing spec.
//
// Chorus sends are pad/arp only (bass through chorus = low-end phase cancellation).
// delayTimeSec: GatedReverb/WideChorus = dotted eighth = 0.75*60/bpm;
//               DarkDelay = eighth = 0.5*60/bpm; Dry = 0.
const FX: Record<FxProfile, (bpm: number) => FxBase> = {
  GatedReverb: (bpm) => ({
    profile: "GatedReverb",
    delayTimeSec: (0.75 * 60) / bpm,
    delayFeedback: 0.25,
    delayFilterHz: null,
    reverbDurationSec: 2.0,
    reverbDecay: 1.5,
    reverbGateSec: 0.28,
    chorus: null,
    sends: {
      kick: { dry: 1, delay: 0, reverb: 0.05, chorus: 0 },
      snare: { dry: 1, delay: 0.1, reverb: 0.45, chorus: 0 },
      hihat: { dry: 1, delay: 0.08, reverb: 0.12, chorus: 0 },
      bass: { dry: 1, delay: 0, reverb: 0.03, chorus: 0 },
      pad: { dry: 1, delay: 0.15, reverb: 0.3, chorus: 0 },
      arp: { dry: 1, delay: 0.2, reverb: 0.2, chorus: 0 },
    },
    delayReturn: 0.6,
    reverbReturn: 0.7,
    chorusReturn: 1.0,
    masterLevel: 0.8,
  }),
  DarkDelay: (bpm) => ({
    profile: "DarkDelay",
    delayTimeSec: (0.5 * 60) / bpm,
    delayFeedback: 0.45,
    delayFilterHz: 1200,
    reverbDurationSec: 1.2,
    reverbDecay: 3.0,
    reverbGateSec: null,
    chorus: null,
    sends: {
      kick: { dry: 1, delay: 0, reverb: 0.02, chorus: 0 },
      snare: { dry: 1, delay: 0.25, reverb: 0.15, chorus: 0 },
      hihat: { dry: 1, delay: 0.15, reverb: 0.05, chorus: 0 },
      bass: { dry: 1, delay: 0.08, reverb: 0, chorus: 0 },
      pad: { dry: 1, delay: 0.3, reverb: 0.15, chorus: 0 },
      arp: { dry: 1, delay: 0.35, reverb: 0.1, chorus: 0 },
    },
    delayReturn: 0.6,
    reverbReturn: 0.7,
    chorusReturn: 1.0,
    masterLevel: 0.8,
  }),
  WideChorus: (bpm) => ({
    profile: "WideChorus",
    delayTimeSec: (0.75 * 60) / bpm,
    delayFeedback: 0.2,
    delayFilterHz: null,
    reverbDurationSec: 1.5,
    reverbDecay: 2.0,
    reverbGateSec: null,
    chorus: { delayMsL: 8, delayMsR: 12, depthMs: 2, rateHzL: 0.6, rateHzR: 0.8 },
    sends: {
      kick: { dry: 1, delay: 0, reverb: 0.05, chorus: 0 },
      snare: { dry: 1, delay: 0.08, reverb: 0.2, chorus: 0 },
      hihat: { dry: 1, delay: 0.05, reverb: 0.1, chorus: 0 },
      bass: { dry: 1, delay: 0, reverb: 0.02, chorus: 0 },
      pad: { dry: 1, delay: 0.1, reverb: 0.25, chorus: 0.3 },
      arp: { dry: 1, delay: 0.12, reverb: 0.15, chorus: 0.3 },
    },
    delayReturn: 0.6,
    reverbReturn: 0.7,
    chorusReturn: 1.0,
    masterLevel: 0.8,
  }),
  Dry: () => ({
    profile: "Dry",
    delayTimeSec: 0,
    delayFeedback: 0,
    delayFilterHz: null,
    reverbDurationSec: 0,
    reverbDecay: 0,
    reverbGateSec: null,
    chorus: null,
    sends: {
      kick: DRY_SEND,
      snare: DRY_SEND,
      hihat: DRY_SEND,
      bass: DRY_SEND,
      pad: DRY_SEND,
      arp: DRY_SEND,
    },
    delayReturn: 0,
    reverbReturn: 0,
    chorusReturn: 0,
    masterLevel: 0.8,
  }),
};

// ─── Pad articulation ───────────────────────────────────────────────────────
// pad_sustain toggles articulation ONLY — the oscillator/waveform is unchanged.
const PAD_SUSTAINED: PadParams = {
  sustain: true,
  attackSec: 0.15,
  decayToLevel: 1.0,
  decayByPortion: 0.8,
};
const PAD_RHYTHMIC: PadParams = {
  sustain: false,
  attackSec: 0.01,
  decayToLevel: 0.2,
  decayByPortion: 0.4,
};

// ─── Arp voice ──────────────────────────────────────────────────────────────
// Fixed pluck voice for all themes in this slice.
const ARP: ArpParams = {
  level: 0.35,
  attackSec: 0.005,
  maxDecaySec: 0.3,
  filterStartMul: 6,
  filterEndMul: 1.5,
  filterSweepSec: 0.15,
};

/** Clamp bpm to [40, 300]; non-finite or <= 0 → 120. */
function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 120;
  return Math.min(300, Math.max(40, bpm));
}

/**
 * Longest post-note ring a single dry voice sustains after its note, using the
 * ACTUAL palette params so the winning voice is never hardcoded.
 *   kick: subDecaySec + 0.05 osc-stop margin
 *   snare/hihat: their longest decay layer
 *   bass: 0.05 (envelope ends AT durSec; margin only)
 *   pad: 0.1 (osc-stop margin)
 *   arp: maxDecaySec
 */
function dryOverhangSec(
  kick: KickParams,
  snare: SnareParams,
  hihat: HihatParams,
  arp: ArpParams,
): number {
  const kickTail = kick.subDecaySec + 0.05;
  const snareTail = Math.max(snare.noiseDecaySec, snare.bodyDecaySec, snare.ringDecaySec);
  const hihatTail = Math.max(hihat.metallicDecaySec, hihat.noiseDecaySec);
  const bassTail = 0.05;
  const padTail = 0.1;
  const arpTail = arp.maxDecaySec;
  return Math.max(kickTail, snareTail, hihatTail, bassTail, padTail, arpTail);
}

/** FX ring-out: the longer of the reverb tail (gate if present, else full IR)
 *  and the delay feedback decay to -60dB (0.001). */
function fxRingSec(fx: FxBase): number {
  const reverbTail = fx.reverbGateSec ?? fx.reverbDurationSec;
  const delayTail =
    fx.delayFeedback > 0
      ? fx.delayTimeSec * Math.ceil(Math.log(0.001) / Math.log(fx.delayFeedback))
      : 0;
  return Math.max(reverbTail, delayTail);
}

/**
 * PURE — no logging, no side effects. Maps a (validated) ThemeSound + bpm to the
 * full concrete DSP parameter set. bpm is clamped to [40, 300] (non-finite/<=0 → 120).
 */
export function deriveTimbre(sound: ThemeSound, bpm: number): TimbreParams {
  const clamped = clampBpm(bpm);
  const { kick, snare, hihat } = DRUMS[sound.drum_palette];
  const pad = sound.pad_sustain ? PAD_SUSTAINED : PAD_RHYTHMIC;
  const arp = ARP;
  const fxBase = FX[sound.fx_profile](clamped);
  const renderTailSec = dryOverhangSec(kick, snare, hihat, arp) + fxRingSec(fxBase) + 0.1;
  return {
    kick,
    snare,
    hihat,
    pad,
    arp,
    fx: { ...fxBase, renderTailSec },
  };
}

// Known enum-string variants, taken from the exhaustive tables so validation can
// never drift from what deriveTimbre actually supports.
const KNOWN_PALETTES = new Set<string>(Object.keys(DRUMS));
const KNOWN_PROFILES = new Set<string>(Object.keys(FX));

function isValidSound(v: unknown): v is ThemeSound {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.drum_palette === "string" &&
    KNOWN_PALETTES.has(s.drum_palette) &&
    typeof s.fx_profile === "string" &&
    KNOWN_PROFILES.has(s.fx_profile) &&
    typeof s.pad_sustain === "boolean"
  );
}

/**
 * Normalization for arrangements: reads {sound, bpm} off an UNKNOWN arrangement
 * with full runtime validation. drum_palette/fx_profile must be one of the known
 * enum string variants; pad_sustain must be a boolean; bpm a finite positive
 * number. ANY invalid/missing piece falls back (sound → DEFAULT_SOUND, bpm → 120)
 * with ONE console.warn per call — legacy/malformed data must degrade, never
 * crash deriveTimbre. This is where impurity lives.
 */
export function renderMetaFromArrangement(arrangement: unknown): {
  sound: ThemeSound;
  bpm: number;
} {
  const arr =
    typeof arrangement === "object" && arrangement !== null
      ? (arrangement as Record<string, unknown>)
      : {};

  let fellBack = false;

  let sound: ThemeSound;
  if (isValidSound(arr.sound)) {
    sound = arr.sound;
  } else {
    sound = DEFAULT_SOUND;
    fellBack = true;
  }

  let bpm: number;
  if (typeof arr.bpm === "number" && Number.isFinite(arr.bpm) && arr.bpm > 0) {
    bpm = arr.bpm;
  } else {
    bpm = 120;
    fellBack = true;
  }

  if (fellBack) {
    console.warn(
      "[timbre] arrangement sound/bpm metadata missing or invalid; falling back to DEFAULT_SOUND/120",
    );
  }

  return { sound, bpm };
}

/**
 * mulberry32 PRNG: same seed → same sequence, cross-platform. Returns a function
 * yielding numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a 32-bit over parts, each prefixed with a type tag ("s:" for string,
 * "n:" for number) and terminated with "\x1f". The tag makes seedFrom("1") !==
 * seedFrom(1); the terminator makes ("ab","c") !== ("a","bc"). Returns an
 * unsigned 32-bit integer.
 */
export function seedFrom(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5; // FNV offset basis
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
  };
  for (const part of parts) {
    const tag = typeof part === "number" ? "n:" : "s:";
    feed(tag + String(part) + "\x1f");
  }
  return hash >>> 0;
}
