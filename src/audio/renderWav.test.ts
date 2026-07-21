// @vitest-environment node
//
// renderArrangementToWav renders an Arrangement through OfflineAudioContext using
// the SAME synthesis code the user hears in the browser, then encodes 16-bit stereo
// PCM WAV bytes. happy-dom has no audio graph, so this suite runs under the `node`
// environment and polyfills OfflineAudioContext from `node-web-audio-api`.
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(async () => {
  // Provide a real OfflineAudioContext implementation for the render.
  const naw = await import("node-web-audio-api");
  (globalThis as any).OfflineAudioContext ??= naw.OfflineAudioContext;
});

const arr = {
  drum_lanes: [
    {
      name: "DRUMS_KICK",
      midi_note: 36,
      events: [
        { timestamp_ms: 0, duration_ms: 200, velocity: 120, midi_note: 36, source_event_id: null },
      ],
    },
  ],
  bass_lane: null,
  pad_lane: null,
  arp_lane: null,
  template: "synthwave_straight",
  total_duration_ms: 1000,
  bar_count: 1,
  theme_name: "BLADE RUNNER",
  bpm: 120,
  sound: { drum_palette: "SynthwaveDrums", fx_profile: "GatedReverb", pad_sustain: true },
} as any;

/** Expected total render length in frames = (total_duration_ms/1000 + FX/voice
 *  tail) * sampleRate. The tail is DERIVED from the fixture's sound/bpm via
 *  deriveTimbre — never hardcoded, so palette/profile changes can't drift it. */
async function expectedFrames(arrangement: any, sampleRate: number): Promise<number> {
  const { deriveTimbre } = await import("./timbre");
  const timbre = deriveTimbre(arrangement.sound, arrangement.bpm);
  const durationSec = arrangement.total_duration_ms / 1000 + timbre.fx.renderTailSec;
  return Math.max(1, Math.ceil(durationSec * sampleRate));
}

describe("renderArrangementToWav", () => {
  it("produces a non-silent RIFF/WAVE file of the right length", async () => {
    const { renderArrangementToWav } = await import("./renderWav");
    const wav = await renderArrangementToWav(arr, 44100);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    const data = new Int16Array(wav.buffer, 44);
    expect(data.length).toBe((await expectedFrames(arr, 44100)) * 2 /*stereo*/);
    const peak = Math.max(...Array.from(data.slice(0, 44100)).map(Math.abs));
    expect(peak).toBeGreaterThan(1000); // kick at t=0 is audible, not silence
  });

  // Step 1 (TDD RED against today's Math.random noise/IR): two renders of the
  // same arrangement must be sample-identical. Seeded noise/IR (Task 3) makes
  // this pass; the old module reseeded with Math.random every render → FAIL.
  //
  // Bound is ±1 LSB on decoded samples, not raw byte equality: ConvolverNode
  // implementations (Chromium's partitioned FFT, and rarely node-web-audio-api
  // under CPU contention) are not bit-reproducible at the 16-bit quantization
  // boundary. Genuine nondeterminism (unseeded noise, a moved note) produces
  // diffs of hundreds of LSB and still fails loudly.
  it("render_is_deterministic", async () => {
    const { renderArrangementToWav } = await import("./renderWav");
    const a = await renderArrangementToWav(arr, 44100);
    const b = await renderArrangementToWav(arr, 44100);
    expect(a.length).toBe(b.length);
    const sa = new Int16Array(a.buffer, 44);
    const sb = new Int16Array(b.buffer, 44);
    let maxAbsDiff = 0;
    for (let i = 0; i < sa.length; i++) {
      const d = Math.abs(sa[i] - sb[i]);
      if (d > maxAbsDiff) maxAbsDiff = d;
    }
    expect(maxAbsDiff).toBeLessThanOrEqual(1);
  });

  // Step 3: a DENSE arrangement (all six voices firing at t=0, max velocity, the
  // busiest BLADE RUNNER sound) must never clip. The group/master headroom + send
  // topology should keep every summed sample below full scale.
  it("no_clipping_headroom", async () => {
    const { renderArrangementToWav } = await import("./renderWav");
    const dense = {
      drum_lanes: [
        {
          name: "DRUMS_KICK",
          midi_note: 36,
          events: [{ timestamp_ms: 0, duration_ms: 200, velocity: 127, midi_note: 36, source_event_id: null }],
        },
        {
          name: "DRUMS_SNARE",
          midi_note: 38,
          events: [{ timestamp_ms: 0, duration_ms: 200, velocity: 127, midi_note: 38, source_event_id: null }],
        },
        {
          name: "DRUMS_HIHAT",
          midi_note: 42,
          events: [{ timestamp_ms: 0, duration_ms: 200, velocity: 127, midi_note: 42, source_event_id: null }],
        },
      ],
      bass_lane: {
        name: "BASS",
        midi_note: 36,
        events: [{ timestamp_ms: 0, duration_ms: 500, velocity: 127, midi_note: 36, source_event_id: null }],
      },
      pad_lane: {
        name: "PADS",
        midi_note: 48,
        events: [{ timestamp_ms: 0, duration_ms: 800, velocity: 127, midi_note: 48, source_event_id: null }],
      },
      arp_lane: {
        name: "ARP",
        midi_note: 60,
        events: [{ timestamp_ms: 0, duration_ms: 200, velocity: 127, midi_note: 60, source_event_id: null }],
      },
      template: "synthwave_straight",
      total_duration_ms: 1000,
      bar_count: 1,
      theme_name: "BLADE RUNNER",
      bpm: 120,
      sound: { drum_palette: "SynthwaveDrums", fx_profile: "GatedReverb", pad_sustain: true },
    } as any;

    const wav = await renderArrangementToWav(dense, 44100);
    const data = new Int16Array(wav.buffer, 44);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] / 0x7fff); // decode 16-bit PCM back to [-1, 1]
      if (v > peak) peak = v;
    }
    expect(peak).toBeGreaterThan(0); // sanity: the dense mix is not silent
    expect(peak).toBeLessThan(0.99); // headroom: never slams full scale / clips
  });
});
