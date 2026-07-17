import { describe, it, expect, beforeEach } from "vitest";
import {
  buildProfileJson,
  saveCalibrationSamples,
  loadCalibrationSamples,
  clearCalibrationSamples,
  isCalibrationSufficient,
  MIN_SAMPLES_PER_CLASS,
  type CalibrationSampleInput,
} from "./calibrationStore";

const sample = (classId: number): CalibrationSampleInput => ({
  classId,
  features: [400, 0.08, 0.6, 0.3, 0.1, 0.8, 4.0],
});

describe("buildProfileJson", () => {
  it("groups samples by Rust EventClass name with the serde field shape", () => {
    const json = buildProfileJson("me", [sample(0), sample(0), sample(1)]);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("me");
    expect(parsed.version).toBe(2);
    // Grouped under the Rust variant names.
    expect(parsed.samples.BilabialPlosive).toHaveLength(2);
    expect(parsed.samples.HihatNoise).toHaveLength(1);
    // Each sample carries the CalibrationSample serde fields.
    const s = parsed.samples.BilabialPlosive[0];
    expect(s.class).toBe("BilabialPlosive");
    expect(s.features).toMatchObject({
      spectral_centroid: 400,
      zcr: 0.08,
      low_band_energy: 0.6,
      mid_band_energy: 0.3,
      high_band_energy: 0.1,
      peak_amplitude: 0.8,
      crest_factor: 4.0,
    });
    expect(s.raw_window).toEqual([]);
    expect(s.sample_rate).toBe(44100);
  });

  it("maps all four classIds to the right variant names", () => {
    const json = buildProfileJson("me", [sample(0), sample(1), sample(2), sample(3)]);
    const keys = Object.keys(JSON.parse(json).samples).sort();
    expect(keys).toEqual(["BilabialPlosive", "Click", "HihatNoise", "HumVoiced"]);
  });
});

describe("localStorage round-trip", () => {
  beforeEach(() => clearCalibrationSamples());

  it("saves and loads samples", () => {
    const samples = [sample(0), sample(3)];
    saveCalibrationSamples(samples);
    expect(loadCalibrationSamples()).toEqual(samples);
  });

  it("returns null when nothing is stored", () => {
    expect(loadCalibrationSamples()).toBeNull();
  });

  it("filters malformed records on load", () => {
    localStorage.setItem(
      "beatrice.calibration.v1",
      JSON.stringify([sample(0), { classId: "x" }, { features: [1] }])
    );
    expect(loadCalibrationSamples()).toEqual([sample(0)]);
  });

  it("survives non-array garbage", () => {
    localStorage.setItem("beatrice.calibration.v1", "{}");
    expect(loadCalibrationSamples()).toBeNull();
  });
});

describe("isCalibrationSufficient", () => {
  /** Build a full profile with `n` samples for every class (0..3). */
  const fullProfile = (n: number): CalibrationSampleInput[] =>
    [0, 1, 2, 3].flatMap((classId) => Array.from({ length: n }, () => sample(classId)));

  it("is false for null / empty", () => {
    expect(isCalibrationSufficient(null)).toBe(false);
    expect(isCalibrationSufficient([])).toBe(false);
  });

  it("is true only with >= MIN_SAMPLES_PER_CLASS for all four classes", () => {
    // Mirrors the Rust is_sufficient bar (matches the re-seed activation rule).
    expect(isCalibrationSufficient(fullProfile(MIN_SAMPLES_PER_CLASS))).toBe(true);
    expect(isCalibrationSufficient(fullProfile(MIN_SAMPLES_PER_CLASS + 3))).toBe(true);
    // One short on the last class.
    const short = [...fullProfile(MIN_SAMPLES_PER_CLASS)];
    const lastClassIdx = short.map((s) => s.classId).lastIndexOf(3);
    short.splice(lastClassIdx, 1);
    expect(isCalibrationSufficient(short)).toBe(false);
  });

  it("is false when a class is entirely missing", () => {
    // Classes 0,1,2 fully taught but class 3 (HUM) absent.
    const missingHum = [0, 1, 2].flatMap((classId) =>
      Array.from({ length: MIN_SAMPLES_PER_CLASS }, () => sample(classId))
    );
    expect(isCalibrationSufficient(missingHum)).toBe(false);
  });
});
