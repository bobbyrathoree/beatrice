import { describe, it, expect } from "vitest";
import {
  calibrationReducer,
  INITIAL_CALIBRATION_STATE,
  CALIBRATION_CLASSES,
  SAMPLES_PER_CLASS,
  TOTAL_SAMPLES,
  type CalibrationState,
} from "./calibrationMachine";

/** Drive the reducer through a sequence of actions from a start state. */
function run(
  actions: Array<Parameters<typeof calibrationReducer>[1]>,
  from: CalibrationState = INITIAL_CALIBRATION_STATE
): CalibrationState {
  return actions.reduce((s, a) => calibrationReducer(s, a), from);
}

describe("calibrationReducer", () => {
  it("starts idle", () => {
    expect(INITIAL_CALIBRATION_STATE.phase).toBe("idle");
  });

  it("START enters teaching for the first class with no samples", () => {
    const s = calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "START" });
    expect(s).toEqual({ phase: "teaching", classIdx: 0, samplesSoFar: 0 });
  });

  it("RECORD_SAMPLE increments within a class", () => {
    const s = run([{ type: "START" }, { type: "RECORD_SAMPLE" }, { type: "RECORD_SAMPLE" }]);
    expect(s).toMatchObject({ phase: "teaching", classIdx: 0, samplesSoFar: 2 });
  });

  it("advances to the next class after SAMPLES_PER_CLASS samples", () => {
    const actions = [
      { type: "START" as const },
      ...Array<{ type: "RECORD_SAMPLE" }>(SAMPLES_PER_CLASS).fill({ type: "RECORD_SAMPLE" }),
    ];
    const s = run(actions);
    expect(s).toMatchObject({ phase: "teaching", classIdx: 1, samplesSoFar: 0 });
  });

  it("reaches done only after teaching all four classes", () => {
    const recordAll = Array<{ type: "RECORD_SAMPLE" }>(TOTAL_SAMPLES).fill({
      type: "RECORD_SAMPLE",
    });
    // One short of the last sample: still teaching the final class.
    const almost = run([{ type: "START" }, ...recordAll.slice(0, TOTAL_SAMPLES - 1)]);
    expect(almost.phase).toBe("teaching");
    expect(almost.classIdx).toBe(CALIBRATION_CLASSES.length - 1);

    // The final sample flips to done.
    const done = calibrationReducer(almost, { type: "RECORD_SAMPLE" });
    expect(done.phase).toBe("done");
  });

  it("ignores RECORD_SAMPLE outside teaching (no over-count)", () => {
    // From idle.
    expect(calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "RECORD_SAMPLE" })).toEqual(
      INITIAL_CALIBRATION_STATE
    );
    // From done: reaching done then recording again must not mutate.
    const done = run([
      { type: "START" },
      ...Array<{ type: "RECORD_SAMPLE" }>(TOTAL_SAMPLES).fill({ type: "RECORD_SAMPLE" }),
    ]);
    expect(done.phase).toBe("done");
    expect(calibrationReducer(done, { type: "RECORD_SAMPLE" })).toEqual(done);
  });

  it("CANCEL and RESET return to idle from anywhere", () => {
    const mid = run([{ type: "START" }, { type: "RECORD_SAMPLE" }]);
    expect(calibrationReducer(mid, { type: "CANCEL" })).toEqual(INITIAL_CALIBRATION_STATE);
    expect(calibrationReducer(mid, { type: "RESET" })).toEqual(INITIAL_CALIBRATION_STATE);
  });

  it("RESTORE enters the restored state from idle (returning session)", () => {
    const s = calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "RESTORE" });
    expect(s).toEqual({ phase: "restored", classIdx: 0, samplesSoFar: 0 });
  });

  it("RESTORE is ignored once teaching or done (no clobbering live progress)", () => {
    const teaching = run([{ type: "START" }, { type: "RECORD_SAMPLE" }]);
    expect(calibrationReducer(teaching, { type: "RESTORE" })).toEqual(teaching);

    const done = run([
      { type: "START" },
      ...Array<{ type: "RECORD_SAMPLE" }>(TOTAL_SAMPLES).fill({ type: "RECORD_SAMPLE" }),
    ]);
    expect(done.phase).toBe("done");
    expect(calibrationReducer(done, { type: "RESTORE" })).toEqual(done);
  });

  it("RECORD_SAMPLE is ignored in restored (the toggle is live, not teaching)", () => {
    const restored = calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "RESTORE" });
    expect(calibrationReducer(restored, { type: "RECORD_SAMPLE" })).toEqual(restored);
  });

  it("START re-teaches out of restored (RE-TEACH button)", () => {
    const restored = calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "RESTORE" });
    const s = calibrationReducer(restored, { type: "START" });
    expect(s).toEqual({ phase: "teaching", classIdx: 0, samplesSoFar: 0 });
  });

  it("CANCEL and RESET leave restored back to idle", () => {
    const restored = calibrationReducer(INITIAL_CALIBRATION_STATE, { type: "RESTORE" });
    expect(calibrationReducer(restored, { type: "CANCEL" })).toEqual(INITIAL_CALIBRATION_STATE);
    expect(calibrationReducer(restored, { type: "RESET" })).toEqual(INITIAL_CALIBRATION_STATE);
  });
});
