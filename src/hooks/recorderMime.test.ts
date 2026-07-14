// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  negotiateRecorderMimeType,
  RECORDER_MIME_PREFERENCES,
} from "./recorderMime";

// The negotiation reads the global `MediaRecorder.isTypeSupported`. happy-dom
// does not define MediaRecorder, so each test installs a stub shaped like the
// engine it is emulating, then restores the global afterward.
const g = globalThis as unknown as { MediaRecorder?: unknown };

afterEach(() => {
  delete g.MediaRecorder;
  vi.restoreAllMocks();
});

/** Install a fake MediaRecorder whose isTypeSupported approves `supported`. */
function installEngine(supported: readonly string[]) {
  g.MediaRecorder = {
    isTypeSupported: vi.fn((t: string) => supported.includes(t)),
  };
  return (g.MediaRecorder as { isTypeSupported: ReturnType<typeof vi.fn> })
    .isTypeSupported;
}

describe("negotiateRecorderMimeType", () => {
  it("picks webm/opus on Chromium (the e2e path must stay webm/opus)", () => {
    installEngine([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
    expect(negotiateRecorderMimeType()).toBe("audio/webm;codecs=opus");
  });

  it("falls through to mp4/aac when only mp4 is supported (WebKit that reports honestly)", () => {
    installEngine(["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);
    expect(negotiateRecorderMimeType()).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("returns '' (browser default) when isTypeSupported approves nothing (WKWebView lying about support)", () => {
    installEngine([]); // every probe returns false
    expect(negotiateRecorderMimeType()).toBe("");
  });

  it("returns '' when MediaRecorder.isTypeSupported is not a function (WKWebView may omit it)", () => {
    // MediaRecorder exists but has no usable probe.
    g.MediaRecorder = {};
    expect(negotiateRecorderMimeType()).toBe("");
  });

  it("returns '' when MediaRecorder is undefined entirely (non-browser env)", () => {
    delete g.MediaRecorder;
    expect(negotiateRecorderMimeType()).toBe("");
  });

  it("stops probing once it reaches the empty-string terminal fallback", () => {
    const probe = installEngine([]); // nothing supported
    negotiateRecorderMimeType();
    // The default list ends in "" — the probe must never be called with "".
    expect(probe).not.toHaveBeenCalledWith("");
    // And it should have probed each non-empty preference exactly once.
    const nonEmpty = RECORDER_MIME_PREFERENCES.filter((t) => t !== "");
    expect(probe).toHaveBeenCalledTimes(nonEmpty.length);
  });

  it("honors a custom preference list, mp4-first", () => {
    installEngine(["audio/webm", "audio/mp4"]);
    expect(
      negotiateRecorderMimeType(["audio/mp4", "audio/webm", ""])
    ).toBe("audio/mp4");
  });

  it("returns '' when a preference list has no empty fallback and nothing matches", () => {
    installEngine([]);
    expect(negotiateRecorderMimeType(["audio/webm", "audio/mp4"])).toBe("");
  });
});
