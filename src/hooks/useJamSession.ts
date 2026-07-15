// useJamSession — Phase 3 Task 4, VISUAL JAM ([GATE-FAIL]) form.
//
// The Phase 3 latency spike recorded NO-GO (acoustic P95 ~100ms vs the 60ms
// budget; docs/latency.md), so live synth triggering is DISABLED. On each
// worklet event we only:
//   1. flash it visually (append to `liveEvents`),
//   2. push it into the rolling JamBuffer (UI/inspection history), and
//   3. bump `eventCount`.
// There are NO scheduleKick/Snare/... calls — the user's mouth does not drive
// real-time synthesis (that path missed the acoustic budget).
//
// CAPTURE ARCHITECTURE (Codex-hardened, single source of truth): live events
// are PREVIEW ONLY and are discarded at capture. `capture()` returns a WAV of
// the last N seconds of the mic, recorded in PARALLEL on the main thread via
// MediaRecorder -> decodeAudioData -> encodeWav16 (Phase 1). That WAV enters the
// app exactly like an upload: the caller feeds it to
// `commands.createProject(...)` -> the EXISTING offline pipeline. This is fully
// frontend so it also works in the browser mock demo. We do NOT use the native
// Rust start_recording/stop_recording path.

import { useCallback, useRef, useState } from "react";
import { loadDetectorNode } from "../worklet/loadDetector";
import { encodeWav16 } from "../audio/renderWav";
import { JamBuffer } from "./jamBuffer";
import { negotiateRecorderMimeType } from "./recorderMime";
import { loadCalibrationSamples, isCalibrationSufficient } from "./calibrationStore";

/** EventClass id emitted by the WASM detector (0=kick,1=hihat,2=snare/click,3=hum). */
export type JamClassId = 0 | 1 | 2 | 3;

/** A live detector event surfaced to the UI for flash tiles. */
export interface JamLiveEvent {
  /** monotonically increasing key for React lists */
  key: number;
  /** onset time relative to stream start (ms) */
  tMs: number;
  /** classified EventClass id (post-toggle: reflects HEURISTIC or YOURS) */
  classId: JamClassId;
  /** classification confidence [0,1] */
  conf: number;
  /**
   * The event's 27-float feature vector
   * ([centroid, zcr, low, mid, high, peak, crest, mfcc1..mfcc20]). Forwarded by
   * the worklet so the calibration panel can echo a detected event back as a
   * labeled sample.
   */
  features: number[];
}

export interface JamSession {
  /** true between a successful start() and stop()/capture() teardown */
  isRunning: boolean;
  /** null unless start() failed */
  error: string | null;
  /** recent live events (capped tail) for flash tiles */
  liveEvents: JamLiveEvent[];
  /** cumulative count of events since start() (never trimmed) */
  eventCount: number;
  /** smoothed input RMS level [0,1] for the meter */
  level: number;
  /** the live AnalyserNode, for the waveform canvas (null until ready) */
  analyser: AnalyserNode | null;
  /**
   * true when start() re-seeded the live detector with a SUFFICIENT persisted
   * profile (≥5 samples for all 4 classes). The returning user's calibration is
   * usable immediately — the panel opens in its `restored` state so the
   * HEURISTIC/YOURS toggle works without re-teaching. false when there was no
   * usable persisted profile (fresh session).
   */
  calibrationRestored: boolean;
  /** begin a jam session: mic -> worklet (visual) + parallel WAV recording */
  start: () => Promise<void>;
  /** stop and discard everything (no WAV) */
  stop: () => Promise<void>;
  /** stop, return the last-N-seconds mic recording as WAV bytes */
  capture: () => Promise<Uint8Array>;
  /**
   * Teach the live detector one labeled sample (Task 5 few-shot calibration).
   * `features` is the event's 27-float [EventFeatures 7, mfcc 20] vector.
   */
  addCalibrationSample: (classId: JamClassId, features: number[]) => void;
  /** Flip the FACTORY/YOURS A/B toggle on the live detector. */
  setCalibrationEnabled: (enabled: boolean) => void;
  /**
   * Drop the live detector's calibration profile (kNN reverts to heuristic).
   * Called when a re-teach begins so freshly taught samples don't append onto a
   * profile re-seeded at start — otherwise the worklet and localStorage would
   * drift (Finding 2).
   */
  resetCalibration: () => void;
}

/** How many seconds of the rolling mic recording capture() keeps. */
const CAPTURE_WINDOW_SEC = 12;
/** JamBuffer window (ms) — matches the capture window for consistent history. */
const BUFFER_WINDOW_MS = CAPTURE_WINDOW_SEC * 1000;
/** How many recent events to keep for flash tiles. */
const LIVE_TAIL = 32;

export function useJamSession(): JamSession {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<JamLiveEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [calibrationRestored, setCalibrationRestored] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The mimeType the recorder is actually producing (engine-negotiated). Used to
  // label the capture Blob honestly. "" means "browser default" — we then read
  // the recorder's own `mimeType` at capture instead of asserting a container.
  const recMimeRef = useRef<string>("");
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bufferRef = useRef<JamBuffer>(new JamBuffer(BUFFER_WINDOW_MS));
  const keyRef = useRef(0);

  const teardown = useCallback(async () => {
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      /* recorder already stopped */
    }
    recorderRef.current = null;
    nodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      await ctxRef.current?.close();
    } catch {
      /* context already closed */
    }
    nodeRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    setAnalyser(null);
    setLevel(0);
    setIsRunning(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLiveEvents([]);
    setEventCount(0);
    setCalibrationRestored(false);
    bufferRef.current = new JamBuffer(BUFFER_WINDOW_MS);
    keyRef.current = 0;
    chunksRef.current = [];

    try {
      const ctx = new AudioContext();
      await ctx.resume();
      ctxRef.current = ctx;

      // Transients must NOT be smeared by the browser's voice-processing DSP.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const node = await loadDetectorNode(ctx);
      nodeRef.current = node;

      // Rolling mic recording (the CAPTURE source of truth). Runs in parallel
      // with detection; timeslice so onstop always has flushed chunks.
      //
      // The mimeType MUST be negotiated per engine: WKWebView (the native macOS
      // app) does not support webm/opus and would throw NotSupportedError or
      // mislabel an mp4/aac blob as webm if left to the no-arg default. We probe
      // isTypeSupported, construct with the winner, and — belt and braces —
      // retry with no options (browser default) if construction still throws.
      const negotiated = negotiateRecorderMimeType();
      let rec: MediaRecorder;
      try {
        rec = negotiated
          ? new MediaRecorder(stream, { mimeType: negotiated })
          : new MediaRecorder(stream);
      } catch {
        // Engine rejected the negotiated type (WKWebView can lie about support).
        // Fall back to the browser default before giving up.
        rec = new MediaRecorder(stream);
      }
      // Record what the recorder is truly producing (may differ from negotiated
      // when we fell back to the default), for an honest capture Blob type.
      recMimeRef.current = rec.mimeType || negotiated;
      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(1000);
      recorderRef.current = rec;

      // Analyser for the waveform canvas + level meter. Routed through a MUTED
      // gain to the destination so the node is actually pulled by the graph
      // without leaking mic audio to the speakers.
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      const muted = ctx.createGain();
      muted.gain.value = 0;
      an.connect(muted);
      muted.connect(ctx.destination);
      analyserRef.current = an;
      setAnalyser(an);

      // [GATE-FAIL] VISUAL JAM: on each detector event, flash + buffer only.
      // The StreamingDetector posts { type:"event", t, tMs, classId, conf, features }.
      // The classId here already reflects the live A/B toggle (kNN when YOURS is
      // on and the profile is sufficient, else heuristic) — so flipping the
      // toggle visibly changes the tile colors/labels for subsequent events.
      node.port.onmessage = (e: MessageEvent) => {
        const data = e.data as {
          type: string;
          t?: number;
          tMs?: number;
          classId?: number;
          conf?: number;
          features?: number[];
        };
        if (data.type !== "event") return;
        const tMs = data.tMs ?? 0;
        const classId = (data.classId ?? 0) as JamClassId;
        const conf = data.conf ?? 0;
        const features = data.features ?? [];

        bufferRef.current.push({ t_ms: tMs, classId, conf });
        const key = keyRef.current++;
        setLiveEvents((prev) => {
          const next = [...prev, { key, tMs, classId, conf, features }];
          return next.length > LIVE_TAIL ? next.slice(-LIVE_TAIL) : next;
        });
        setEventCount((c) => c + 1);
      };

      // Re-seed the detector with any persisted calibration so a returning user
      // keeps their personalization. Samples cross the wasm boundary the same
      // way live teaching does. Calibration stays OFF until the user flips the
      // A/B toggle — re-seeding only makes YOURS available, it does not force it.
      //
      // When the persisted set is SUFFICIENT (≥5 samples for all 4 classes) the
      // returning user's profile is usable immediately: we flag it so the panel
      // can open in its `restored` state and expose the toggle without forcing a
      // re-teach (Finding 1). An insufficient set is still re-seeded (it keeps
      // whatever partial samples exist) but does not surface the toggle.
      const persisted = loadCalibrationSamples();
      if (persisted && persisted.length > 0) {
        for (const s of persisted) {
          node.port.postMessage({
            type: "calibrate",
            classId: s.classId,
            features: s.features,
          });
        }
        setCalibrationRestored(isCalibrationSufficient(persisted));
      }

      // Mic -> detector (silent; connected to destination so process() is
      // pulled) and mic -> analyser. The worklet writes no output, so wiring it
      // to the destination is acoustically silent.
      const src = ctx.createMediaStreamSource(stream);
      src.connect(node);
      node.connect(ctx.destination);
      src.connect(an);

      // Level meter: smoothed RMS of the time-domain signal, ~20fps.
      const timeBuf = new Float32Array(an.fftSize);
      levelTimerRef.current = setInterval(() => {
        an.getFloatTimeDomainData(timeBuf);
        let sum = 0;
        for (let i = 0; i < timeBuf.length; i++) sum += timeBuf[i] * timeBuf[i];
        const rms = Math.sqrt(sum / timeBuf.length);
        setLevel((prev) => prev * 0.6 + Math.min(1, rms * 4) * 0.4);
      }, 50);

      setIsRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await teardown();
    }
  }, [teardown]);

  const stop = useCallback(async () => {
    await teardown();
  }, [teardown]);

  const capture = useCallback(async (): Promise<Uint8Array> => {
    const ctx = ctxRef.current;
    const rec = recorderRef.current;
    if (!ctx || !rec) {
      throw new Error("No active jam session to capture");
    }

    // Blob type must match what the recorder actually produced (webm/opus on
    // Chromium, mp4/aac on WKWebView). Prefer the recorder's live `mimeType`,
    // fall back to the engine-negotiated type captured at start(). Do NOT hard-
    // code "audio/webm" — that mislabels WKWebView's mp4 container.
    const blobType = rec.mimeType || recMimeRef.current;
    // Flush the recorder and gather all chunks into one blob.
    const blob = await new Promise<Blob>((resolve) => {
      if (rec.state === "inactive") {
        resolve(new Blob(chunksRef.current, blobType ? { type: blobType } : undefined));
        return;
      }
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, blobType ? { type: blobType } : undefined));
      };
      rec.stop();
    });

    // IMPORTANT ORDERING: decode BEFORE teardown(). `decodeAudioData` runs on
    // `ctx`, and teardown() calls `ctx.close()`; decoding after close would
    // reject. `decodeAudioData` is container-agnostic (it sniffs the bytes), so
    // it handles both the Chromium webm/opus and WKWebView mp4/aac blobs.
    // Decode -> slice last N seconds -> re-encode as PCM16 WAV (Phase 1).
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const sr = decoded.sampleRate;
    const wantFrames = Math.min(decoded.length, Math.ceil(CAPTURE_WINDOW_SEC * sr));
    const startFrame = decoded.length - wantFrames;
    const sliced = new AudioBuffer({
      length: wantFrames,
      numberOfChannels: decoded.numberOfChannels,
      sampleRate: sr,
    });
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      sliced.copyToChannel(decoded.getChannelData(c).subarray(startFrame), c, 0);
    }
    const wav = encodeWav16(sliced);

    await teardown();
    return wav;
  }, [teardown]);

  // --- Task 5: few-shot calibration control (main -> worklet) ---
  const addCalibrationSample = useCallback(
    (classId: JamClassId, features: number[]) => {
      nodeRef.current?.port.postMessage({ type: "calibrate", classId, features });
    },
    []
  );

  const setCalibrationEnabled = useCallback((enabled: boolean) => {
    nodeRef.current?.port.postMessage({ type: "setCalibration", enabled });
  }, []);

  const resetCalibration = useCallback(() => {
    // Clearing the worklet profile means a just-restored session is no longer
    // "restored" — the user is teaching a fresh profile from scratch.
    setCalibrationRestored(false);
    nodeRef.current?.port.postMessage({ type: "resetCalibration" });
  }, []);

  return {
    isRunning,
    error,
    liveEvents,
    eventCount,
    level,
    analyser,
    calibrationRestored,
    start,
    stop,
    capture,
    addCalibrationSample,
    setCalibrationEnabled,
    resetCalibration,
  };
}
