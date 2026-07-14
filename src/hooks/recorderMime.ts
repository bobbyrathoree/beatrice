// recorderMime — MediaRecorder mimeType negotiation for jam capture.
//
// Why this exists: `new MediaRecorder(stream)` with no explicit mimeType is NOT
// portable across the two engines Beatrice ships on. Chromium (dev/e2e) records
// webm/opus; macOS WKWebView (the NATIVE Tauri app — where jam capture actually
// matters because the real offline analysis runs there) does NOT support
// webm/opus and will instead produce mp4/aac. Left to its defaults the
// constructor can throw NotSupportedError, or worse, hand back an mp4/aac blob
// mislabeled as "audio/webm". We therefore probe `isTypeSupported` over a
// preference list covering both engines and pick the first that fits.
//
// The downstream (`decodeAudioData`) sniffs the container bytes, so it accepts
// either webm/opus or mp4/aac transparently — negotiation only needs to make the
// RECORDER succeed and label its Blob honestly.

/**
 * Recorder mimeType preferences, best-first, covering both engines:
 *   - webm/opus, webm      → Chromium (and the Playwright e2e)
 *   - mp4/aac (mp4a.40.2)  → WebKit / WKWebView (the native macOS app)
 *   - ""                   → terminal fallback: let the browser pick its default.
 *
 * The empty-string fallback is load-bearing: WKWebView has historically returned
 * false/undefined from `isTypeSupported` for types it can actually record, so we
 * must always be willing to construct with no mimeType and trust the engine.
 */
export const RECORDER_MIME_PREFERENCES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "",
];

/**
 * Pick the best-supported MediaRecorder mimeType for the current engine.
 *
 * Probes `MediaRecorder.isTypeSupported` over `preferences` and returns the
 * first supported type. Returns "" ("let the browser pick its default") when:
 *   - `MediaRecorder` is undefined (non-browser / test env),
 *   - `MediaRecorder.isTypeSupported` is not a function (WKWebView may omit it),
 *   - or nothing in the list probes true.
 *
 * The empty string is a VALID, working choice — the caller constructs the
 * recorder with no `mimeType` option in that case, which every engine supports.
 */
export function negotiateRecorderMimeType(
  preferences: readonly string[] = RECORDER_MIME_PREFERENCES
): string {
  const hasProbe =
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function";

  for (const type of preferences) {
    // The empty string is the terminal "browser default" fallback; probing it
    // is meaningless, so accept it as soon as it is reached.
    if (type === "") return "";
    if (hasProbe && MediaRecorder.isTypeSupported(type)) return type;
  }

  // No preference matched and the list had no empty-string fallback: still fall
  // back to the browser default rather than failing to record.
  return "";
}
