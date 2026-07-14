// calibrationMachine — the pure state machine behind the CalibrationPanel
// (Phase 3 Task 5, few-shot voice calibration).
//
// Extracted from the component so the teach flow is unit-testable without a DOM
// or a live worklet. The panel is a thin renderer over this reducer; the only
// side effect (posting a calibration sample to the worklet) is driven by the
// caller when it dispatches RECORD_SAMPLE, keeping this module pure.
//
// FLOW: idle → teaching(classIdx, samplesSoFar) → ... → done
//   - START enters teaching for class 0 with 0 samples (also the RE-TEACH path
//     out of `done`/`restored`).
//   - RECORD_SAMPLE bumps samplesSoFar; at SAMPLES_PER_CLASS it advances to the
//     next class (resetting the per-class counter), or to `done` after the last.
//   - CANCEL returns to idle from anywhere.
//   - RESET returns to idle (e.g. after persisting on done).
//   - RESTORE enters `restored` — the entry state for a RETURNING session whose
//     persisted profile was re-seeded onto the worklet and is already SUFFICIENT.
//     It renders the same HEURISTIC/YOURS toggle as `done` plus a RE-TEACH
//     button, so the toggle works immediately without re-teaching all 20 samples
//     (Finding 1). `restored` is not reached by teaching — only by RESTORE.

/** The four classes to teach, in prompt order. classId === index. */
export const CALIBRATION_CLASSES = [
  { classId: 0, name: "KICK", hint: 'your "B" / "P" / boom' },
  { classId: 1, name: "HI-HAT", hint: 'your "TS" / "SS" hiss' },
  { classId: 2, name: "SNARE", hint: 'your "K" / "T" snap' },
  { classId: 3, name: "HUM", hint: "a sustained vowel / hum" },
] as const;

/** Samples required per class before advancing (matches Rust is_sufficient). */
export const SAMPLES_PER_CLASS = 5;

export type CalibrationPhase = "idle" | "teaching" | "done" | "restored";

export interface CalibrationState {
  phase: CalibrationPhase;
  /** index into CALIBRATION_CLASSES currently being taught (teaching only). */
  classIdx: number;
  /** samples recorded for the current class so far (0..SAMPLES_PER_CLASS). */
  samplesSoFar: number;
}

export type CalibrationAction =
  | { type: "START" }
  | { type: "RECORD_SAMPLE" }
  | { type: "CANCEL" }
  | { type: "RESET" }
  | { type: "RESTORE" };

export const INITIAL_CALIBRATION_STATE: CalibrationState = {
  phase: "idle",
  classIdx: 0,
  samplesSoFar: 0,
};

export function calibrationReducer(
  state: CalibrationState,
  action: CalibrationAction
): CalibrationState {
  switch (action.type) {
    case "START":
      // Restart the flow from the first class regardless of prior state.
      return { phase: "teaching", classIdx: 0, samplesSoFar: 0 };

    case "RECORD_SAMPLE": {
      // Ignore samples arriving outside the teaching phase (e.g. a late worklet
      // event after done/cancel) so the machine can't over-count.
      if (state.phase !== "teaching") return state;

      const nextCount = state.samplesSoFar + 1;
      if (nextCount < SAMPLES_PER_CLASS) {
        return { ...state, samplesSoFar: nextCount };
      }
      // Current class complete → advance or finish.
      const nextClass = state.classIdx + 1;
      if (nextClass >= CALIBRATION_CLASSES.length) {
        return { phase: "done", classIdx: state.classIdx, samplesSoFar: nextCount };
      }
      return { phase: "teaching", classIdx: nextClass, samplesSoFar: 0 };
    }

    case "RESTORE":
      // A returning session re-seeded a SUFFICIENT persisted profile onto the
      // worklet. Enter `restored` so the panel exposes the HEURISTIC/YOURS
      // toggle immediately, without re-teaching (Finding 1). Ignored once the
      // user is already mid-teach or has just finished (`teaching`/`done`) so a
      // late restore signal can't clobber live progress; only a fresh `idle`
      // panel adopts the restored profile.
      if (state.phase !== "idle") return state;
      return { phase: "restored", classIdx: 0, samplesSoFar: 0 };

    case "CANCEL":
    case "RESET":
      return INITIAL_CALIBRATION_STATE;

    default:
      return state;
  }
}

/** Total samples across all classes needed to finish (for progress display). */
export const TOTAL_SAMPLES = CALIBRATION_CLASSES.length * SAMPLES_PER_CLASS;
