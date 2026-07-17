import { describe, it, expect, vi } from "vitest";

// Prove the real mock + generated bindings produce single-wrapped Results,
// camelCase arg enforcement works, and the demo pipeline shape is coherent.
vi.mock("@tauri-apps/api/core", () => import("./utils/tauri-mock"));

describe("mock <-> bindings parity", () => {
  it("Result-typed command single-wraps (no double {status})", async () => {
    const { commands, unwrap } = await import("./types/ipc");
    const r = await commands.listProjects();
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      // data must be the bare array, NOT another {status} object
      expect(Array.isArray(r.data)).toBe(true);
    }
    expect(unwrap(r)).toEqual([]);
  });

  it("bare-value command (greet) resolves the plain value", async () => {
    const { commands } = await import("./types/ipc");
    const greeting = await commands.greet("Beatrice");
    expect(greeting).toBe("Hello Beatrice!");
  });

  it("full demo pipeline: create_project -> detect -> quantize -> arrange", async () => {
    const { commands, unwrap } = await import("./types/ipc");
    // 2s of silence WAV-ish bytes is enough for the mock's event generator.
    const bytes = new Array(44 + 44100 * 2 * 2).fill(0);
    const project = unwrap(await commands.createProject({ name: "Demo", input_data: bytes }));
    expect(project.id).toBeTruthy();

    const det = unwrap(await commands.detectEvents({
      file_path: project.input_path, run_id: null, use_calibration: false, calibration_profile_id: null,
    }));
    expect(det.events.length).toBeGreaterThan(0);

    const q = unwrap(await commands.quantizeEventsCommand({
      events: det.events, bpm: 120, time_signature: "four_four", division: "sixteenth",
      feel: "straight", swing_amount: 0, bar_count: 4, quantize_strength: 0.8, lookahead_ms: 100,
    }));
    expect(q.length).toBe(det.events.length);
    expect(typeof q[0].quantized_timestamp_ms).toBe("number");

    const arr = unwrap(await commands.arrangeEventsCommand({
      events: q, template: "synthwave_straight", theme_name: "BLADE RUNNER", bpm: 120,
      time_signature: "four_four", division: "sixteenth", feel: "straight", swing_amount: 0,
      bar_count: 4, b_emphasis: 0.6,
    }));
    expect(arr.drum_lanes.length).toBeGreaterThan(0);
    expect(typeof arr.total_duration_ms).toBe("number");
  });

  it("detect_events with calibration flags mirrors the Rust contract", async () => {
    const { commands, unwrap } = await import("./types/ipc");
    const bytes = new Array(44 + 44100 * 2 * 2).fill(0);
    const project = unwrap(await commands.createProject({ name: "Cal", input_data: bytes }));
    // Valid id → events flow (mock has no real profiles; it only checks shape).
    const det = unwrap(await commands.detectEvents({
      file_path: project.input_path, run_id: null,
      use_calibration: true, calibration_profile_id: "mock-cal-1",
    }));
    expect(det.events.length).toBeGreaterThan(0);
    // Flag without id → rejects, same as the Rust command.
    const bad = await commands.detectEvents({
      file_path: project.input_path, run_id: null,
      use_calibration: true, calibration_profile_id: null,
    });
    expect(bad.status).toBe("error");
  });

  it("contract drift: missing camelCase key rejects (throws)", async () => {
    const mock = await import("./utils/tauri-mock");
    // list_runs_for_project requires `projectId` (camelCase). snake_case must throw.
    await expect(mock.invoke("list_runs_for_project", { project_id: "x" })).rejects.toThrow(/contract drift/);
    // Correct camelCase resolves.
    await expect(mock.invoke("list_runs_for_project", { projectId: "x" })).resolves.toEqual([]);
  });

  it("unknown command rejects", async () => {
    const mock = await import("./utils/tauri-mock");
    await expect(mock.invoke("does_not_exist", {})).rejects.toThrow(/Unknown command/);
  });
});
