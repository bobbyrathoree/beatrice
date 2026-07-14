// calibrationStore — persistence for few-shot voice calibration (Phase 3 Task 5).
//
// A calibration profile is a set of labeled samples (classId + the 7-float
// EventFeatures vector) the user taught in jam mode. This module is the single,
// pure, unit-testable home for:
//   1. building the Rust `CalibrationProfile` JSON shape from accumulated
//      samples (so the native offline `detect_events` use_calibration path can
//      parse it via `CalibrationProfile::from_json_bytes`), and
//   2. localStorage save/load of the raw samples so the worklet can be RE-SEEDED
//      on the next jam start.
//
// WHY localStorage IS THE RE-SEED SOURCE IN BOTH ENVIRONMENTS: the native
// `list_calibration_profiles` command returns only metadata (id/name/path) — it
// does NOT hand the sample JSON back to the frontend (that lives in a file the
// backend reads server-side). So to re-seed the live worklet we cache the raw
// samples in localStorage in both browser and native. On native we ADDITIONALLY
// register the profile in the DB (via `create_calibration_profile`) so the
// existing offline pipeline can use it — see `persistNative`.

import { commands, unwrap } from "../types/ipc";
import { isTauriAvailable } from "../utils/tauri-mock";

/** A labeled calibration sample as accumulated on the main thread. */
export interface CalibrationSampleInput {
  /** EventClass id (0=kick, 1=hihat, 2=snare/click, 3=hum). */
  classId: number;
  /** 7-float EventFeatures vector: [centroid, zcr, low, mid, high, peak, crest]. */
  features: number[];
}

/** classId -> Rust EventClass variant name (index === classId). */
const CLASS_NAMES = ["BilabialPlosive", "HihatNoise", "Click", "HumVoiced"] as const;

/**
 * Minimum samples PER CLASS for a profile to classify with kNN. Mirrors the
 * Rust `CalibrationProfile::is_sufficient` (≥5 for all 4 classes) and the
 * `SAMPLES_PER_CLASS` the teach flow collects. Kept here so the frontend can
 * decide whether a re-seeded profile is immediately usable without a wasm call.
 */
export const MIN_SAMPLES_PER_CLASS = 5;
/** The four classIds a sufficient profile must cover (0=kick..3=hum). */
const REQUIRED_CLASS_IDS = [0, 1, 2, 3] as const;

/**
 * Whether a set of samples is sufficient for kNN — ≥`MIN_SAMPLES_PER_CLASS` for
 * ALL four classes (the same bar as Rust `is_sufficient`). A re-seeded profile
 * that clears this bar can be activated immediately in a returning session
 * (the HEURISTIC/YOURS toggle works without re-teaching).
 */
export function isCalibrationSufficient(
  samples: CalibrationSampleInput[] | null | undefined
): boolean {
  if (!samples || samples.length === 0) return false;
  const counts = new Map<number, number>();
  for (const s of samples) {
    counts.set(s.classId, (counts.get(s.classId) ?? 0) + 1);
  }
  return REQUIRED_CLASS_IDS.every((id) => (counts.get(id) ?? 0) >= MIN_SAMPLES_PER_CLASS);
}

/** localStorage key (versioned so a shape change can't crash on stale data). */
const LS_KEY = "beatrice.calibration.v1";
const SAMPLE_RATE = 44100;

/** Map a 7-float vector to the Rust `EventFeatures` JSON object. */
function toFeatures(f: number[]): Record<string, number> {
  return {
    spectral_centroid: f[0] ?? 0,
    zcr: f[1] ?? 0,
    low_band_energy: f[2] ?? 0,
    mid_band_energy: f[3] ?? 0,
    high_band_energy: f[4] ?? 0,
    peak_amplitude: f[5] ?? 0,
    crest_factor: f[6] ?? 0,
  };
}

/**
 * Build the Rust `CalibrationProfile` JSON string from accumulated samples.
 * Shape mirrors `crates/beatrice-dsp/src/events/calibration.rs` serde output:
 *   { name, samples: { <ClassName>: [ {class, features, raw_window, sample_rate} ] },
 *     version, created_at }
 * so `CalibrationProfile::from_json_bytes` round-trips it on the native side.
 */
export function buildProfileJson(name: string, samples: CalibrationSampleInput[]): string {
  const grouped: Record<string, unknown[]> = {};
  for (const s of samples) {
    const className = CLASS_NAMES[s.classId] ?? "Click";
    (grouped[className] ??= []).push({
      class: className,
      features: toFeatures(s.features),
      raw_window: [] as number[],
      sample_rate: SAMPLE_RATE,
    });
  }
  return JSON.stringify({
    name,
    samples: grouped,
    version: 1,
    created_at: new Date().toISOString(),
  });
}

/** Cache the raw samples in localStorage so the worklet can be re-seeded later. */
export function saveCalibrationSamples(samples: CalibrationSampleInput[]): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(samples));
    }
  } catch {
    /* private mode / quota — persistence is best-effort */
  }
}

/** Load the cached raw samples (for re-seeding the worklet). `null` if none. */
export function loadCalibrationSamples(): CalibrationSampleInput[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Defensive: keep only well-formed records.
    return parsed.filter(
      (s): s is CalibrationSampleInput =>
        s &&
        typeof s.classId === "number" &&
        Array.isArray(s.features) &&
        s.features.length >= 7
    );
  } catch {
    return null;
  }
}

/** Drop any persisted calibration (localStorage only). */
export function clearCalibrationSamples(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Persist a finished profile. Always caches the raw samples to localStorage
 * (the worklet re-seed source). On native it ALSO registers the profile in the
 * DB via `create_calibration_profile`, so the offline `detect_events`
 * use_calibration path can consume the same personalization. Returns the native
 * profile id when one was created, else null. Never throws — persistence is
 * best-effort and must not break the jam UI.
 */
export async function persistCalibration(
  name: string,
  samples: CalibrationSampleInput[]
): Promise<string | null> {
  saveCalibrationSamples(samples);
  if (!isTauriAvailable()) return null;
  try {
    const json = buildProfileJson(name, samples);
    const bytes = Array.from(new TextEncoder().encode(json));
    const profile = unwrap(
      await commands.createCalibrationProfile({
        name,
        profile_data: bytes,
        notes: null,
      })
    );
    return profile.id;
  } catch {
    // DB write failed (or command missing) — localStorage cache still stands.
    return null;
  }
}
