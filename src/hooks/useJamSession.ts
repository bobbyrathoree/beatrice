// useJamSession — Phase 3 SPIKE hook.
//
// Wires the live path end-to-end so the latency harness has something real to
// measure: mic -> AudioWorklet (WASM RMS detector) -> on "hit" schedule a kick.
// This is deliberately minimal (the productionized session lands in Tasks 4-5).
// The verified WASM-in-worklet loading sequence lives in ../worklet/loadDetector.

import { useCallback, useRef, useState } from "react";
import {
  createFxBus,
  scheduleKick,
  type FxBus,
} from "../audio/scheduleArrangement";
import { loadDetectorNode } from "../worklet/loadDetector";

export interface JamHit {
  /** worklet `currentTime` (seconds) when the transient was detected */
  t: number;
}

export interface JamSession {
  status: "idle" | "starting" | "ready" | "error";
  error: string | null;
  start: (onHit?: (hit: JamHit) => void) => Promise<void>;
  stop: () => Promise<void>;
}

export function useJamSession(): JamSession {
  const [status, setStatus] = useState<JamSession["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const busRef = useRef<FxBus | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async (onHit?: (hit: JamHit) => void) => {
    setStatus("starting");
    setError(null);
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      ctxRef.current = ctx;

      // Master FX bus -> speakers. Kicks are scheduled onto this bus.
      const bus = createFxBus(ctx, ctx.destination);
      busRef.current = bus;

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

      // Route subsequent hits to a kick + optional caller callback.
      node.port.onmessage = (e: MessageEvent) => {
        const data = e.data as { type: string; t?: number };
        if (data.type === "hit") {
          scheduleKick(ctx, bus, ctx.currentTime, 120);
          onHit?.({ t: data.t ?? ctx.currentTime });
        }
      };

      // Mic -> detector. The worklet only reads its input (returns true); it
      // produces no audio, so we do not connect it to the destination.
      const src = ctx.createMediaStreamSource(stream);
      src.connect(node);

      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const stop = useCallback(async () => {
    nodeRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await ctxRef.current?.close();
    nodeRef.current = null;
    streamRef.current = null;
    busRef.current = null;
    ctxRef.current = null;
    setStatus("idle");
  }, []);

  return { status, error, start, stop };
}
