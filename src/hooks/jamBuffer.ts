// JamBuffer — the rolling window of live jam events.
//
// Phase 3 Task 4 (VISUAL JAM / [GATE-FAIL] form). Live worklet events are
// PREVIEW ONLY: they drive flash tiles and this rolling buffer, then are
// DISCARDED at capture. The authoritative analysis comes from the offline
// pipeline running on the captured mic WAV — see useJamSession.capture().
//
// This class exists purely for UI (flash history) and as a pure, unit-testable
// core. It holds the last `windowMs` of events (evicted relative to the NEWEST
// event, not wall-clock, so a paused/backgrounded tab does not lose history)
// and can materialize an `Event`-shaped list rebased to the buffer's start.

import type { EventClass, EventData } from "../types/ipc";

/** A single live detector event as pushed from the worklet (`tMs` -> `t_ms`). */
export interface JamEvent {
  /** onset time relative to stream start (ms) */
  t_ms: number;
  /** classified EventClass id (0=kick, 1=hihat, 2=snare/click, 3=hum) */
  classId: number;
  /** classification confidence [0,1] */
  conf: number;
}

/**
 * classId -> EventClass string. Mirrors the WASM detector's class_id mapping
 * (crates/beatrice-dsp: 0=kick, 1=hihat, 2=snare/click, 3=hum). Out-of-range
 * ids fall back to BilabialPlosive so a garbled event never crashes the UI.
 */
export const JAM_CLASS_TO_EVENT_CLASS: Record<number, EventClass> = {
  0: "BilabialPlosive",
  1: "HihatNoise",
  2: "Click",
  3: "HumVoiced",
};

// Per-class default features so the offline pipeline is never fed a NaN. These
// are cosmetic only — the real classifier re-derives features from the captured
// WAV; captured live events never reach the arranger. Chosen to loosely match
// each class's acoustic signature (see tauri-mock generateMockEvents).
const DEFAULT_FEATURES: Record<EventClass, EventData["features"]> = {
  BilabialPlosive: { spectral_centroid: 400, zcr: 0.08, low_band_energy: 0.6, mid_band_energy: 0.3, high_band_energy: 0.1, peak_amplitude: 0.8 },
  HihatNoise: { spectral_centroid: 4200, zcr: 0.45, low_band_energy: 0.05, mid_band_energy: 0.25, high_band_energy: 0.7, peak_amplitude: 0.6 },
  Click: { spectral_centroid: 1800, zcr: 0.3, low_band_energy: 0.2, mid_band_energy: 0.6, high_band_energy: 0.2, peak_amplitude: 0.7 },
  HumVoiced: { spectral_centroid: 600, zcr: 0.05, low_band_energy: 0.3, mid_band_energy: 0.45, high_band_energy: 0.25, peak_amplitude: 0.6 },
};

/**
 * An offline-pipeline `Event`-shaped object that ALSO carries the rebased
 * `t_ms` (matching the live `JamEvent` field), so a single materialized object
 * satisfies both the Event contract and the live-event timeline.
 */
export type JamCapturedEvent = EventData & { t_ms: number };

export class JamBuffer {
  private buf: JamEvent[] = [];

  constructor(private readonly windowMs: number) {}

  /** Append an event and evict anything older than `windowMs` before the newest. */
  push(e: JamEvent): void {
    this.buf.push(e);
    const cutoff = e.t_ms - this.windowMs;
    // Events arrive monotonically (stream time), so a leading-edge trim suffices.
    this.buf = this.buf.filter((x) => x.t_ms > cutoff);
  }

  /** The raw live events currently inside the window (oldest first). */
  events(): JamEvent[] {
    return [...this.buf];
  }

  /**
   * Materialize the buffered events as offline-pipeline `Event`-shaped objects,
   * rebased so the earliest event sits at t=0. Used only for UI/inspection; the
   * captured WAV (not this) is the pipeline's real input.
   */
  capture(): JamCapturedEvent[] {
    if (this.buf.length === 0) return [];
    const base = this.buf[0].t_ms;
    return this.buf.map((e, i) => {
      const cls = JAM_CLASS_TO_EVENT_CLASS[e.classId] ?? "BilabialPlosive";
      const rebased = e.t_ms - base;
      return {
        id: `jam-${i}`,
        t_ms: rebased,
        timestamp_ms: rebased,
        duration_ms: 50,
        class: cls,
        confidence: e.conf,
        features: { ...DEFAULT_FEATURES[cls] },
        all_scores: [],
      };
    });
  }
}
