// @vitest-environment node
//
// Step 2 — Offline A/B proof that two theme "sounds" differ MEASURABLY.
//
// One hand-written arrangement (identical notes for every render) is rendered
// through the real themed synth (OfflineAudioContext) under several ThemeSounds.
// The only thing that changes between renders is `sound` (drum palette + FX
// profile + pad articulation) — so any measured difference in the output is
// attributable purely to the theme's sound design, not to different notes.
//
// happy-dom has no audio graph, so (like renderWav.test.ts) this runs under the
// `node` environment and polyfills OfflineAudioContext from node-web-audio-api.
//
// Threshold policy (from the plan's Global Constraints): implement → PRINT the
// measured feature values → set the final threshold to ~half the measured margin
// with a comment recording the measurement. The console.log lines below emit
// every measured value so the numbers behind each threshold are auditable.
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  wavToMono,
  wavToStereo,
  bandProportions,
  rmsEnvelope,
  l1Sum,
  meanAbsDiff,
  energyInWindow,
  stereoWidth,
} from "./audioFeatures";
import type { ThemeSound } from "../bindings";

const SR = 44100;
const AUDITION_DIR = join(process.cwd(), ".superpowers", "audition");

beforeAll(async () => {
  const naw = await import("node-web-audio-api");
  (globalThis as any).OfflineAudioContext ??= naw.OfflineAudioContext;
});

// ─── The shared fixture ───────────────────────────────────────────────────────
// 2 bars @ 120bpm (one bar = 2000ms). Every render uses THESE notes; only `sound`
// differs. Late snare (3900) + late arp (3800) deliberately excite the FX tails
// right before the boundary so tail-length differences show up in the render.
const BR_SOUND: ThemeSound = { drum_palette: "SynthwaveDrums", fx_profile: "GatedReverb", pad_sustain: true };
const ST_SOUND: ThemeSound = { drum_palette: "TR808", fx_profile: "DarkDelay", pad_sustain: false };

function note(timestamp_ms: number, duration_ms: number, velocity: number, midi_note: number | null = null) {
  return { timestamp_ms, duration_ms, velocity, midi_note, source_event_id: null };
}

/** Build the fixture arrangement for a given sound (+ label). Notes are identical. */
function fixture(sound: ThemeSound, theme_name: string) {
  const kick = { name: "DRUMS_KICK", midi_note: 36, events: [0, 1000, 2000, 3000].map((t) => note(t, 200, 120)) };
  const snare = { name: "DRUMS_SNARE", midi_note: 38, events: [500, 1500, 2500, 3900].map((t) => note(t, 200, 110)) };
  const hihatTimes: number[] = [];
  for (let t = 0; t < 4000; t += 250) hihatTimes.push(t);
  const hihat = { name: "DRUMS_HIHAT", midi_note: 42, events: hihatTimes.map((t) => note(t, 120, 90)) };

  const bass = { name: "BASS", midi_note: 33 /* A1 */, events: [note(0, 900, 100)] };

  // Pad triad D3/F3/A3 (D-minor), all sustained 0→1800ms.
  const pad = {
    name: "PADS",
    midi_note: 50 /* D3 */,
    events: [note(0, 1800, 90, 50), note(0, 1800, 90, 53), note(0, 1800, 90, 57)],
  };

  // Arp D4/F4/A4/D5 sequenced, plus a late one at 3800ms to excite the tail.
  const arp = {
    name: "ARP",
    midi_note: 62 /* D4 */,
    events: [
      note(0, 250, 100, 62),
      note(500, 250, 100, 65),
      note(1000, 250, 100, 69),
      note(1500, 250, 100, 74),
      note(3800, 200, 100, 74),
    ],
  };

  return {
    drum_lanes: [kick, snare, hihat],
    bass_lane: bass,
    pad_lane: pad,
    arp_lane: arp,
    template: "synthwave_straight",
    total_duration_ms: 4000,
    bar_count: 2,
    theme_name,
    bpm: 120,
    sound,
  } as any;
}

// ─── Renders (done once; each is ~6–7s of 44.1kHz audio) ─────────────────────
let brA!: Uint8Array;
let brB!: Uint8Array;
let st!: Uint8Array;
let darkDelay!: Uint8Array;
let chorus!: Uint8Array;
let dry!: Uint8Array;

beforeAll(async () => {
  const { renderArrangementToWav } = await import("./renderWav");
  brA = await renderArrangementToWav(fixture(BR_SOUND, "BLADE RUNNER"), SR);
  brB = await renderArrangementToWav(fixture(BR_SOUND, "BLADE RUNNER"), SR);
  st = await renderArrangementToWav(fixture(ST_SOUND, "STRANGER THINGS"), SR);
  // Isolates the FX profile: identical to brA in EVERY way except fx_profile
  // (BR's kit + sustained pads), so a tail difference vs brA is attributable to
  // DarkDelay alone — not to the TR808 kit or rhythmic pads that also differ in ST.
  darkDelay = await renderArrangementToWav(fixture({ ...BR_SOUND, fx_profile: "DarkDelay" }, "DARK DELAY"), SR);
  chorus = await renderArrangementToWav(fixture({ ...BR_SOUND, fx_profile: "WideChorus" }, "WIDE CHORUS"), SR);
  dry = await renderArrangementToWav(fixture({ ...BR_SOUND, fx_profile: "Dry" }, "DRY"), SR);

  // Write audition WAVs for a human listener; log their paths.
  mkdirSync(AUDITION_DIR, { recursive: true });
  const files: [string, Uint8Array][] = [
    ["br-blade-runner.wav", brA],
    ["st-stranger-things.wav", st],
    ["wide-chorus.wav", chorus],
    ["dry.wav", dry],
  ];
  for (const [name, bytes] of files) {
    const p = join(AUDITION_DIR, name);
    writeFileSync(p, bytes);
    console.log(`[audition] wrote ${p} (${bytes.byteLength} bytes)`);
  }
}, 120_000);

/** Zero-pad a mono signal up to `len` samples (never truncates). */
function padTo(x: Float32Array, len: number): Float32Array {
  if (x.length >= len) return x;
  const out = new Float32Array(len);
  out.set(x);
  return out;
}

describe("theme sounds differ measurably (A/B)", () => {
  it("same_sound_renders_identical_within_1lsb", () => {
    // Deterministic control: identical sound → identical samples to within
    // ±1 LSB. The seeded synthesis is exactly reproducible, but ConvolverNode
    // convolution is not guaranteed bit-reproducible under thread scheduling
    // (observed once under full-suite CPU load; same root cause as the
    // Chromium ±1-LSB jitter documented in e2e/themeSound.spec.ts). Real
    // nondeterminism (unseeded noise, moved notes) diffs by ≫ 1 LSB.
    expect(brA.length).toBe(brB.length);
    const sa = new Int16Array(brA.buffer, 44);
    const sb = new Int16Array(brB.buffer, 44);
    let maxAbsDiff = 0;
    for (let i = 0; i < sa.length; i++) {
      const d = Math.abs(sa[i] - sb[i]);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
    expect(maxAbsDiff).toBeLessThanOrEqual(1);
  });

  it("different_sound_renders_differ_in_band_energy", () => {
    const a = wavToMono(brA);
    const b = wavToMono(st);
    const len = Math.max(a.length, b.length);
    const pA = bandProportions(padTo(a, len), SR);
    const pB = bandProportions(padTo(b, len), SR);
    const delta = l1Sum(pA, pB);
    console.log(`[band] BR proportions = [${pA.map((v) => v.toFixed(4)).join(", ")}]`);
    console.log(`[band] ST proportions = [${pB.map((v) => v.toFixed(4)).join(", ")}]`);
    console.log(`[band] l1Sum(BR, ST) = ${delta.toFixed(4)} (initial floor T_band=0.08)`);
    // MEASURED l1Sum(BR, ST) = 0.3651 (deterministic — seeded render, stable
    // across runs; re-measured after the pad hold-stage fix). Threshold policy:
    // final floor ≈ half the measured margin, comfortably above the 0.08 initial
    // floor. 0.3651/2 ≈ 0.18; the 0.16 floor stays (well below the margin).
    const T_band = 0.16;
    expect(delta).toBeGreaterThan(T_band);
  });

  it("different_sound_renders_differ_in_envelope", () => {
    const a = wavToMono(brA);
    const b = wavToMono(st);
    const envA = rmsEnvelope(a, SR, 0.025);
    const envB = rmsEnvelope(b, SR, 0.025);
    const delta = meanAbsDiff(envA, envB); // meanAbsDiff already spans the min length
    console.log(`[env] meanAbsDiff(BR, ST) = ${delta.toFixed(4)} (initial floor T_env=0.02)`);
    // MEASURED meanAbsDiff(BR, ST) = 0.5513 (deterministic; re-measured after the
    // pad hold-stage fix). Threshold policy: final floor ≈ half the measured margin
    // (0.5513/2 ≈ 0.28), far above the 0.02 initial floor; the 0.26 floor stays.
    const T_env = 0.26;
    expect(delta).toBeGreaterThan(T_env);
  });

  it("dark_delay_tail_outlasts_gated_reverb", () => {
    // FX-isolated A/B: both renders use BR's kit + sustained pads; ONLY the
    // fx_profile differs (GatedReverb vs DarkDelay), so the tail-energy gap is
    // attributable to the delay profile alone, as the test name claims.
    const a = wavToMono(brA); // GatedReverb — gated at 0.28s
    const b = wavToMono(darkDelay); // DarkDelay — long feedback tail (else identical to brA)
    const len = Math.max(a.length, b.length);
    const brMono = padTo(a, len);
    const ddMono = padTo(b, len);
    const eBR = energyInWindow(brMono, SR, 4.05, 4.9);
    const eDD = energyInWindow(ddMono, SR, 4.05, 4.9);
    const ratio = eBR > 0 ? eDD / eBR : Infinity;
    console.log(`[tail] energy[4.05,4.9] GatedReverb=${eBR.toFixed(3)} DarkDelay=${eDD.toFixed(3)} ratio=${ratio.toFixed(2)}x`);
    // MEASURED DarkDelay/GatedReverb tail-energy ratio = 57.84x (deterministic,
    // FX-isolated — only fx_profile differs). DarkDelay's long feedback tail vastly
    // outlasts GatedReverb's 0.28s gate. The brief specifies the fixed 1.2x floor;
    // the measured margin sits far above it, so the floor stays.
    expect(eDD).toBeGreaterThan(1.2 * eBR);
  });

  it("chorus_is_wide_and_dry_is_not", () => {
    const { left: cl, right: cr } = wavToStereo(chorus);
    const { left: dl, right: dr } = wavToStereo(dry);
    const wChorus = stereoWidth(cl, cr);
    const wDry = stereoWidth(dl, dr);
    console.log(`[width] stereoWidth chorus=${wChorus.toFixed(4)} dry=${wDry.toFixed(4)} (initial floor 0.05)`);

    const dryMono = wavToMono(dry);
    const gatedMono = wavToMono(brA); // GatedReverb reference render
    const eDry = energyInWindow(dryMono, SR, 4.2, 4.9);
    const eGated = energyInWindow(gatedMono, SR, 4.2, 4.9);
    const tailRatio = eGated > 0 ? eDry / eGated : Infinity;
    console.log(`[width] tail energy[4.2,4.9] dry=${eDry.toFixed(4)} gatedReverb=${eGated.toFixed(4)} ratio=${tailRatio.toFixed(4)}`);

    // MEASURED chorus width = 0.7322, dry width = 0.0000 (deterministic). An
    // absolute floor is required (a mono/dry mix measures ~0, so a pure ratio
    // would be vacuous); per the threshold policy the final floor is set to
    // ~half the measured width (0.7322/2 ≈ 0.37), well above the 0.05 initial
    // floor. The 2*wDry ratio check is kept as an additional guard.
    const WIDTH_FLOOR = 0.37;
    expect(wChorus).toBeGreaterThan(WIDTH_FLOOR);
    expect(wChorus).toBeGreaterThan(2 * wDry);
    // MEASURED dry tail energy[4.2,4.9] = 0.0000 vs GatedReverb = 119.24: Dry has
    // essentially no tail. Assert < 0.2 * the reverb render's tail energy.
    expect(eDry).toBeLessThan(0.2 * eGated);
  });
});
