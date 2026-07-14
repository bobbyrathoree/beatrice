// JamScreen — Phase 3 Task 4, VISUAL JAM ([GATE-FAIL]) form.
//
// The latency gate recorded NO-GO (docs/latency.md), so this screen is
// deliberately VISUAL-ONLY: mouth sounds flash as class-colored tiles and drive
// a live waveform, but there is NO live synth (that path missed the 60ms
// acoustic budget). The value users get here is CAPTURE: the last N seconds of
// the mic are recorded in parallel and handed to the EXISTING offline pipeline
// exactly like an upload — where the real arrangement is produced.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { commands, unwrap } from "../../types/ipc";
import { EVENT_CLASS_COLORS, EVENT_CLASS_NAMES } from "../../types/explainability";
import type { EventClass } from "../../types/explainability";
import { useJamSession, type JamClassId } from "../../hooks/useJamSession";
import type { Project } from "../../store/useStore";

interface JamScreenProps {
  onProjectCreated: (project: Project) => void;
  onError: (error: string) => void;
  onExit: () => void;
}

const CLASS_ID_TO_EVENT_CLASS: Record<JamClassId, EventClass> = {
  0: "BilabialPlosive",
  1: "HihatNoise",
  2: "Click",
  3: "HumVoiced",
};

export function JamScreen({ onProjectCreated, onError, onExit }: JamScreenProps) {
  const { isRunning, error, liveEvents, eventCount, level, analyser, start, stop, capture } =
    useJamSession();
  const [isCapturing, setIsCapturing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  // Surface start() failures (e.g. mic denied) to the app's notification system.
  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  // Tear the session down if the user navigates away without capturing.
  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live waveform: draw the analyser's time-domain data each frame.
  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const g = canvas.getContext("2d");
    if (!g) return;
    const data = new Uint8Array(analyser.fftSize);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      const w = canvas.width;
      const h = canvas.height;
      g.fillStyle = "#000";
      g.fillRect(0, 0, w, h);
      g.lineWidth = 3;
      g.strokeStyle = "#00FFFF";
      g.beginPath();
      const step = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 255) * h;
        const x = i * step;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser]);

  const handleStart = async () => {
    await start();
  };

  const handleCapture = async () => {
    if (!isRunning || isCapturing) return;
    setIsCapturing(true);
    try {
      const wav = await capture();
      const now = new Date();
      const name = `Jam ${now.toISOString().slice(0, 19).replace("T", " ")}`;
      const project = unwrap(
        await commands.createProject({
          name,
          input_data: Array.from(wav),
        })
      );
      // Hand off to the app's EXISTING pipeline path (same as upload/record).
      onProjectCreated(project);
    } catch (err) {
      setIsCapturing(false);
      onError(err instanceof Error ? err.message : "Jam capture failed");
    }
  };

  return (
    <div
      data-testid="jam-screen"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        width: "100%",
        maxWidth: "860px",
        margin: "0 auto",
        padding: "24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 900, letterSpacing: 2, margin: 0 }}>
          JAM MODE
        </h2>
        {/* Honest note: no live synth on this build. */}
        <p
          data-testid="jam-visual-note"
          style={{ fontSize: "13px", color: "#888", marginTop: 6, maxWidth: 520 }}
        >
          VISUAL MODE — live synth is disabled on built-in laptop audio
          (~100ms &gt; 60ms budget). See docs/latency.md. Your mouth sounds flash
          below; hit CAPTURE to arrange the last few seconds.
        </p>
      </div>

      {/* Live waveform canvas */}
      <canvas
        ref={canvasRef}
        data-testid="jam-waveform"
        width={800}
        height={140}
        style={{
          width: "100%",
          height: "140px",
          border: "4px solid #000",
          borderRadius: "8px",
          background: "#000",
        }}
      />

      {/* Level meter */}
      <div
        style={{
          width: "100%",
          height: "12px",
          border: "3px solid #000",
          borderRadius: "6px",
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <div
          data-testid="jam-level"
          style={{
            width: `${Math.round(level * 100)}%`,
            height: "100%",
            background: "#FF00FF",
            transition: "width 0.05s linear",
          }}
        />
      </div>

      {/* Flash tiles: class-colored, one per recent live event */}
      <div
        data-testid="jam-flashes"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          minHeight: "56px",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          border: "4px solid #000",
          borderRadius: "8px",
          padding: "12px",
          background: "#111",
        }}
      >
        <AnimatePresence initial={false}>
          {liveEvents.map((ev) => {
            const cls = CLASS_ID_TO_EVENT_CLASS[ev.classId] ?? "BilabialPlosive";
            return (
              <motion.div
                key={ev.key}
                data-testid="jam-flash"
                data-class={cls}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                title={EVENT_CLASS_NAMES[cls]}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "6px",
                  border: "2px solid #000",
                  background: EVENT_CLASS_COLORS[cls],
                  boxShadow: `0 0 12px ${EVENT_CLASS_COLORS[cls]}`,
                }}
              />
            );
          })}
          {liveEvents.length === 0 && (
            <span style={{ color: "#666", fontSize: 14 }}>
              {isRunning ? "listening… make some noise" : "press START to begin"}
            </span>
          )}
        </AnimatePresence>
      </div>

      {/* Event counter (drives the e2e assertion) */}
      <div style={{ fontFamily: "monospace", fontSize: 14, color: "#aaa" }}>
        events: <span data-testid="jam-event-count">{eventCount}</span>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
        {!isRunning ? (
          <motion.button
            className="btn btn-primary btn-large"
            data-testid="jam-start"
            onClick={handleStart}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            ● START
          </motion.button>
        ) : (
          <motion.button
            className="btn btn-primary btn-large"
            data-testid="jam-capture"
            onClick={handleCapture}
            disabled={isCapturing}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            {isCapturing ? "◆ CAPTURING…" : "◉ CAPTURE"}
          </motion.button>
        )}
        <motion.button
          className="btn btn-large"
          data-testid="jam-exit"
          onClick={async () => {
            await stop();
            onExit();
          }}
          whileHover={{ scale: 1.03, y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          ← BACK
        </motion.button>
      </div>
    </div>
  );
}
