// CalibrationPanel — few-shot voice calibration UI (Phase 3 Task 5).
//
// [GATE-FAIL adaptation] Jam mode is VISUAL (no live synth), so the A/B toggle
// lets the user SEE the accuracy difference rather than hear it: flipping
// HEURISTIC/YOURS changes how subsequent detected events are classified, which
// changes the flash tiles' colors/labels in JamScreen. Same mechanism the brief
// describes ("users hear the accuracy difference"), honestly reframed to what a
// visual jam can actually show.
//
// TEACH FLOW: press TEACH, then make each prompted sound 5×. Every detected
// event while teaching becomes a labeled CalibrationSample (echoed to the
// worklet via the hook). Progress dots fill 0..5 per class; at `done` the
// profile is persisted (localStorage + native DB) and the A/B toggle unlocks.
//
// This component is a thin renderer over `calibrationMachine` (pure, unit-tested
// separately). It drives sample recording off the parent's `latestEvent` ref:
// when a new event key arrives during teaching, it records one sample.

import { useEffect, useReducer, useRef, useState } from "react";
import { EVENT_CLASS_COLORS, EVENT_CLASS_NAMES } from "../../types/explainability";
import { JAM_CLASS_TO_EVENT_CLASS } from "../../hooks/jamBuffer";
import type { JamClassId, JamLiveEvent } from "../../hooks/useJamSession";
import {
  calibrationReducer,
  INITIAL_CALIBRATION_STATE,
  CALIBRATION_CLASSES,
  SAMPLES_PER_CLASS,
} from "./calibrationMachine";
import {
  persistCalibration,
  type CalibrationSampleInput,
} from "../../hooks/calibrationStore";

interface CalibrationPanelProps {
  /** The most recent live detector event, or null. Drives sample capture. */
  latestEvent: JamLiveEvent | null;
  /** true when the live detector is running (teaching requires a live mic). */
  isRunning: boolean;
  /** Echo a labeled sample to the worklet. */
  onSample: (classId: JamClassId, features: number[]) => void;
  /** Flip the live HEURISTIC/YOURS toggle. */
  onToggle: (enabled: boolean) => void;
  /** Close the panel. */
  onClose: () => void;
}

export function CalibrationPanel({
  latestEvent,
  isRunning,
  onSample,
  onToggle,
  onClose,
}: CalibrationPanelProps) {
  const [state, dispatch] = useReducer(calibrationReducer, INITIAL_CALIBRATION_STATE);
  // true = YOURS (personal), false = HEURISTIC. Starts on HEURISTIC.
  const [personal, setPersonal] = useState(false);
  const [saved, setSaved] = useState(false);

  // Accumulate every recorded sample so we can persist the full profile on done.
  const samplesRef = useRef<CalibrationSampleInput[]>([]);
  // Track the last event key we consumed, so each event is recorded once.
  const lastKeyRef = useRef<number | null>(null);

  // Record a sample whenever a NEW event arrives during teaching.
  useEffect(() => {
    if (state.phase !== "teaching" || !latestEvent) return;
    if (lastKeyRef.current === latestEvent.key) return;
    lastKeyRef.current = latestEvent.key;

    const classId = CALIBRATION_CLASSES[state.classIdx].classId as JamClassId;
    const features = latestEvent.features ?? [];
    if (features.length < 7) return; // ignore feature-less events

    samplesRef.current.push({ classId, features });
    onSample(classId, features);
    dispatch({ type: "RECORD_SAMPLE" });
  }, [latestEvent, state.phase, state.classIdx, onSample]);

  // On reaching done, persist once and reveal the toggle (default to YOURS so
  // the user immediately sees their calibration take effect).
  useEffect(() => {
    if (state.phase !== "done" || saved) return;
    setSaved(true);
    const name = `Jam voice ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    void persistCalibration(name, samplesRef.current);
    setPersonal(true);
    onToggle(true);
  }, [state.phase, saved, onToggle]);

  const handleStart = () => {
    samplesRef.current = [];
    lastKeyRef.current = latestEvent?.key ?? null; // don't consume a stale event
    setSaved(false);
    dispatch({ type: "START" });
  };

  const handleToggle = () => {
    const next = !personal;
    setPersonal(next);
    onToggle(next);
  };

  const current = CALIBRATION_CLASSES[state.classIdx];

  return (
    <div
      data-testid="calibration-panel"
      style={{
        width: "100%",
        border: "4px solid #000",
        borderRadius: 8,
        padding: 16,
        background: "#1a1a1a",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: 1 }}>
          TEACH YOUR VOICE
        </h3>
        <button className="btn" data-testid="calibration-close" onClick={onClose}>
          ✕
        </button>
      </div>

      {state.phase === "idle" && (
        <>
          <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>
            Teach Beatrice YOUR four sounds — make each one {SAMPLES_PER_CLASS}×. Then flip
            HEURISTIC / YOURS to see the tiles re-classify with your voice.
          </p>
          <button
            className="btn btn-primary"
            data-testid="calibration-start"
            onClick={handleStart}
            disabled={!isRunning}
          >
            {isRunning ? "● TEACH" : "start the jam first"}
          </button>
        </>
      )}

      {state.phase === "teaching" && (
        <>
          <p style={{ fontSize: 15, margin: 0 }} data-testid="calibration-prompt">
            Make your{" "}
            <span style={{ color: EVENT_CLASS_COLORS[JAM_CLASS_TO_EVENT_CLASS[current.classId]] }}>
              {current.name}
            </span>{" "}
            sound {SAMPLES_PER_CLASS}× — {current.hint}
          </p>
          {/* Progress dots for the current class */}
          <div style={{ display: "flex", gap: 8 }} data-testid="calibration-dots">
            {Array.from({ length: SAMPLES_PER_CLASS }).map((_, i) => (
              <div
                key={i}
                data-filled={i < state.samplesSoFar}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: "2px solid #000",
                  background:
                    i < state.samplesSoFar
                      ? EVENT_CLASS_COLORS[JAM_CLASS_TO_EVENT_CLASS[current.classId]]
                      : "#333",
                }}
              />
            ))}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888" }}>
            class {state.classIdx + 1}/{CALIBRATION_CLASSES.length}
          </div>
          <button
            className="btn"
            data-testid="calibration-cancel"
            onClick={() => dispatch({ type: "CANCEL" })}
          >
            cancel
          </button>
        </>
      )}

      {state.phase === "done" && (
        <>
          <p style={{ fontSize: 15, margin: 0, color: "#0f0" }} data-testid="calibration-done">
            ✓ Calibrated. Flip the toggle to compare.
          </p>
          <button
            className="btn"
            data-testid="calibration-retrain"
            onClick={handleStart}
            disabled={!isRunning}
          >
            teach again
          </button>
        </>
      )}

      {/* A/B toggle — available once a profile exists (done). Flips how the live
          detector classifies subsequent events, changing the flash tiles. */}
      {state.phase === "done" && (
        <button
          data-testid="calibration-toggle"
          data-personal={personal}
          onClick={handleToggle}
          className="btn"
          style={{
            fontWeight: 900,
            letterSpacing: 1,
            background: personal ? "#00FF00" : "#FF00FF",
            color: "#000",
            border: "3px solid #000",
          }}
        >
          {personal ? "YOURS ●" : "HEURISTIC ●"} — tap to flip
        </button>
      )}

      {/* Live legend so the user can read the tile colors while comparing. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
        {CALIBRATION_CLASSES.map((c) => {
          const cls = JAM_CLASS_TO_EVENT_CLASS[c.classId];
          return (
            <span key={c.classId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: EVENT_CLASS_COLORS[cls],
                  border: "1px solid #000",
                }}
              />
              <span style={{ fontSize: 11, color: "#aaa" }}>{EVENT_CLASS_NAMES[cls]}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
