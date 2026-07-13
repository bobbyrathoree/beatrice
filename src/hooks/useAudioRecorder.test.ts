// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
vi.mock("../types/ipc", () => ({
  commands: {
    startRecording: vi.fn().mockResolvedValue({ status: "ok", data: null }),
    stopRecording: vi.fn().mockResolvedValue({ status: "ok", data: [82, 73, 70, 70] }),
    getRecordingLevel: vi.fn().mockResolvedValue({ status: "ok", data: 0.5 }),
  },
  unwrap: (r: any) => r.data,
  formatIpcError: (e: any) => String(e),
}));
import { useAudioRecorder } from "./useAudioRecorder";
import { commands } from "../types/ipc";

describe("useAudioRecorder", () => {
  beforeEach(() => vi.useFakeTimers());
  it("auto-stops at MAX_DURATION", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(() => result.current.startRecording());
    await act(async () => {
      vi.advanceTimersByTime(30_100);
      await vi.runOnlyPendingTimersAsync();
    });
    expect(commands.stopRecording).toHaveBeenCalled(); // fails today: stale closure sees isRecording=false
  });
  it("cleans up intervals and stops on unmount", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());
    await act(() => result.current.startRecording());
    unmount();
    expect(commands.stopRecording).toHaveBeenCalled(); // fails today: no unmount cleanup
  });
});
