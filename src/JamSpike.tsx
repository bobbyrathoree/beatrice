// JamSpike — Phase 3 SPIKE dev route (/jam-spike).
//
// Two jobs:
//   1. Prove the WASM-in-worklet loading path prints "ready" in BOTH runtimes
//      (Chromium via `npm run dev`, WKWebView via `cargo tauri dev`). A big
//      visible status badge (data-testid="jam-status") makes this screenshot-
//      verifiable in Tauri, where Playwright cannot drive WKWebView.
//   2. Run the loopback latency harness and dump results to
//      `window.__latencyResults` for scripts/measure-latency.mjs (Playwright).
//
// Two measurement modes (query param `?mode=`):
//   - loopback (default): a synthetic click is played through the SPEAKERS,
//     the MIC hears it, the detector fires. Measures the REAL acoustic round
//     trip (DAC out + air + ADC in + worklet buffer + compute + message).
//   - synthetic: the click buffer is routed straight into the worklet inside
//     one AudioContext (NO speakers, NO mic). Measures compute+messaging
//     latency only — the floor, not the acoustic reality. Used as the honest
//     fallback when macOS TCC blocks mic access in the harness.

import { useEffect, useRef, useState } from "react";
import { createFxBus, scheduleKick } from "./audio/scheduleArrangement";
import { loadDetectorNode } from "./worklet/loadDetector";

type Mode = "loopback" | "synthetic";

interface LatencyResults {
  done: boolean;
  mode: Mode;
  detectMs: number[];
  soundMs: number[];
  misses: number;
  reps: number;
  outputLatencyMs: number;
  baseLatencyMs: number;
  error?: string;
}

declare global {
  interface Window {
    __latencyResults?: LatencyResults;
  }
}

const REPS = 20;
const BASE_INTERVAL_MS = 800;
// Deterministic jitter in [-100, +100] ms so runs are reproducible.
const jitterFor = (i: number) => ((i * 37) % 201) - 100;

/** 5ms white-noise burst — a sharp transient the RMS detector will catch. */
function makeClickBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * 0.005);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.9;
  return buf;
}

export default function JamSpike() {
  const [status, setStatus] = useState<string>("idle");
  const [detail, setDetail] = useState<string>("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // guard StrictMode double-invoke
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const mode: Mode = params.get("mode") === "synthetic" ? "synthetic" : "loopback";

    const results: LatencyResults = {
      done: false,
      mode,
      detectMs: [],
      soundMs: [],
      misses: 0,
      reps: REPS,
      outputLatencyMs: 0,
      baseLatencyMs: 0,
    };

    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;

    const finish = (err?: string) => {
      if (err) results.error = err;
      results.done = true;
      window.__latencyResults = results;
      setStatus(err ? "error" : "done");
      setDetail(
        err
          ? err
          : `${mode}: ${results.detectMs.length} hits, ${results.misses} misses`
      );
    };

    (async () => {
      try {
        setStatus("starting");
        ctx = new AudioContext();
        await ctx.resume();
        results.outputLatencyMs = (ctx.outputLatency ?? 0) * 1000;
        results.baseLatencyMs = (ctx.baseLatency ?? 0) * 1000;

        const bus = createFxBus(ctx, ctx.destination);

        // Detector node (shared verified loading path). Prints "ready".
        const node = await loadDetectorNode(ctx);
        if (cancelled) return;
        // The worklet writes nothing to its output buffers, so wiring it to the
        // destination is acoustically SILENT — but it guarantees the node stays
        // in the render graph and process() is pulled in BOTH modes (a node with
        // only input connections and no path to destination can be skipped).
        node.connect(ctx.destination);
        setStatus("ready");
        setDetail(`detector ready (${mode})`);
        // eslint-disable-next-line no-console
        console.log("[jam-spike] detector ready");

        if (mode === "loopback") {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          if (cancelled) return;
          ctx.createMediaStreamSource(stream).connect(node);
        }
        // In synthetic mode the click BufferSource is connected straight to the
        // worklet per-rep (below); no mic, no speaker output for detection.
        //
        // SPIKE FINDING: the worklet only receives an input channel while a
        // source is connected+running. Between bursts the input array is empty,
        // so the stub detector's sample-counted refractory clock would freeze
        // and bursts would be swallowed (misfire pattern 1,0,0,1,...). A live
        // mic (loopback) never has this gap; synthetic mode needs a continuous
        // zero-carrier so `process()` always gets a real (silent) block.
        if (mode === "synthetic") {
          const carrier = new ConstantSourceNode(ctx, { offset: 0 });
          carrier.connect(node);
          carrier.start();
        }

        const click = makeClickBuffer(ctx);

        // --- Click/hit pairing ---
        // Each rep: emit a click, arm `pending`, wait for the FIRST hit, ignore
        // later hits (the kick we fire is itself audible and would double-trip
        // the detector in loopback). Unpaired clicks count as misses.
        let pendingEmitPerf: number | null = null;
        let pendingTimer: ReturnType<typeof setTimeout> | null = null;
        let repResolve: (() => void) | null = null;

        node.port.onmessage = (e: MessageEvent) => {
          const data = e.data as { type: string; t?: number };
          if (data.type !== "hit") return;
          if (mode === "loopback") {
            // React to a real transient with a kick (the jam behaviour).
            scheduleKick(ctx!, bus, ctx!.currentTime, 120);
          }
          if (pendingEmitPerf !== null) {
            const detectMs = performance.now() - pendingEmitPerf;
            results.detectMs.push(detectMs);
            // Mouth-to-sound == detectMs. Do NOT add outputLatencyMs — that
            // double-counts the output path. detectMs is measured from click
            // SCHEDULE to worklet hit message, so it already contains one full
            // output traversal: the stimulus click's DAC+speaker time (air +
            // ADC + input buffer + compute + message follow). That single
            // output path stands in for the response kick's output path — the
            // chain has exactly one output leg either way — so detectMs is
            // itself the correct mouth-to-ear proxy. (See docs/latency.md.)
            results.soundMs.push(detectMs);
            pendingEmitPerf = null;
            if (pendingTimer) clearTimeout(pendingTimer);
            repResolve?.();
          }
        };

        setStatus("running");
        for (let i = 0; i < REPS; i++) {
          if (cancelled) return;
          await new Promise<void>((resolve) => {
            repResolve = resolve;
            const src = ctx!.createBufferSource();
            src.buffer = click;
            if (mode === "loopback") {
              src.connect(ctx!.destination); // out the speakers
            } else {
              src.connect(node); // straight into the detector
            }
            pendingEmitPerf = performance.now();
            src.start();
            // Miss guard: no hit within 500ms -> count and move on.
            pendingTimer = setTimeout(() => {
              if (pendingEmitPerf !== null) {
                results.misses++;
                pendingEmitPerf = null;
                resolve();
              }
            }, 500);
          });
          setDetail(`rep ${i + 1}/${REPS} — ${results.detectMs.length} hits`);
          const wait = BASE_INTERVAL_MS + jitterFor(i);
          await new Promise((r) => setTimeout(r, wait));
        }

        finish();
      } catch (err) {
        finish(err instanceof Error ? err.message : String(err));
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
        // Leave ctx open briefly so late kicks ring out, then close.
        setTimeout(() => ctx?.close().catch(() => {}), 1000);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        fontFamily: "monospace",
        padding: 40,
        background: "#0a0a0a",
        color: "#e0e0e0",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, letterSpacing: 2 }}>BEATRICE — JAM SPIKE</h1>
      <p style={{ opacity: 0.6, maxWidth: 640 }}>
        Phase 3 Task 1 latency harness. Loopback mode plays clicks through the
        speakers and listens on the mic — turn the volume up.
      </p>
      <div
        data-testid="jam-status"
        style={{
          marginTop: 24,
          padding: "16px 24px",
          border: "1px solid #333",
          borderRadius: 8,
          fontSize: 28,
          fontWeight: 700,
          color:
            status === "ready" || status === "done"
              ? "#4ade80"
              : status === "error"
                ? "#f87171"
                : "#fbbf24",
        }}
      >
        {status.toUpperCase()}
      </div>
      <p data-testid="jam-detail" style={{ marginTop: 16, opacity: 0.8 }}>
        {detail}
      </p>
    </div>
  );
}
