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
} as any;

describe("renderArrangementToWav", () => {
  it("produces a non-silent RIFF/WAVE file of the right length", async () => {
    const { renderArrangementToWav } = await import("./renderWav");
    const wav = await renderArrangementToWav(arr, 44100);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    const data = new Int16Array(wav.buffer, 44);
    expect(data.length).toBe(44100 * 2 /*stereo*/ * 1 /*sec*/);
    const peak = Math.max(...Array.from(data.slice(0, 44100)).map(Math.abs));
    expect(peak).toBeGreaterThan(1000); // kick at t=0 is audible, not silence
  });
});
