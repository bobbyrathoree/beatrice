import { describe, it, expect } from "vitest";
import { JamBuffer } from "./jamBuffer";

describe("JamBuffer", () => {
  it("keeps only the last windowMs of events", () => {
    const b = new JamBuffer(4000);
    b.push({ t_ms: 0, classId: 0, conf: 0.9 });
    b.push({ t_ms: 5000, classId: 1, conf: 0.9 });
    expect(b.events().map((e) => e.t_ms)).toEqual([5000]);
  });

  it("capture() rebases timestamps to buffer start", () => {
    const b = new JamBuffer(4000);
    b.push({ t_ms: 5000, classId: 0, conf: 0.9 });
    b.push({ t_ms: 5500, classId: 2, conf: 0.8 });
    expect(b.capture().map((e) => e.t_ms)).toEqual([0, 500]);
  });

  it("capture() maps classId to the EventClass string", () => {
    const b = new JamBuffer(4000);
    b.push({ t_ms: 0, classId: 0, conf: 0.9 }); // kick / Bilabial
    b.push({ t_ms: 100, classId: 1, conf: 0.9 }); // hihat
    b.push({ t_ms: 200, classId: 2, conf: 0.9 }); // snare / click
    b.push({ t_ms: 300, classId: 3, conf: 0.9 }); // hum
    expect(b.capture().map((e) => e.class)).toEqual([
      "BilabialPlosive",
      "HihatNoise",
      "Click",
      "HumVoiced",
    ]);
  });

  it("capture() synthesizes Event-shaped objects with default features", () => {
    const b = new JamBuffer(4000);
    b.push({ t_ms: 0, classId: 0, conf: 0.77 });
    const [ev] = b.capture();
    expect(ev.id).toBeTruthy();
    expect(ev.confidence).toBeCloseTo(0.77);
    expect(ev.duration_ms).toBeGreaterThan(0);
    // Features object is present with the six required numeric fields.
    expect(ev.features).toMatchObject({
      spectral_centroid: expect.any(Number),
      zcr: expect.any(Number),
      low_band_energy: expect.any(Number),
      mid_band_energy: expect.any(Number),
      high_band_energy: expect.any(Number),
      peak_amplitude: expect.any(Number),
    });
  });

  it("eviction is relative to the newest event, not wall clock", () => {
    const b = new JamBuffer(1000);
    b.push({ t_ms: 1000, classId: 0, conf: 0.9 });
    b.push({ t_ms: 1500, classId: 1, conf: 0.9 });
    b.push({ t_ms: 2100, classId: 2, conf: 0.9 });
    // window is [2100-1000, 2100] = [1100, 2100]; the t=1000 event is evicted.
    expect(b.events().map((e) => e.t_ms)).toEqual([1500, 2100]);
  });

  it("events() and capture() are empty on a fresh buffer", () => {
    const b = new JamBuffer(4000);
    expect(b.events()).toEqual([]);
    expect(b.capture()).toEqual([]);
  });
});
