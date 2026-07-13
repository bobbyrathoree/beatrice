// Types for explainability components - showing AI decision-making process.
//
// The wire types (EventClass, AssignedNote, EventFeatures) are re-exported from
// the generated bindings so there is a single source of truth and no hand-written
// drift. The only frontend-specific piece is the `EventDecision` VIEW-MODEL, which
// is assembled in App.tsx from the pipeline result: its timing fields are required
// numbers (App defaults them) so the display components can treat them as non-optional.

import type {
  EventClass,
  EventDecision as BackendEventDecision,
} from "../bindings";

export type { EventClass, AssignedNote, EventFeatures } from "../bindings";

/**
 * Frontend display view-model for a single event's pipeline decision.
 * Derived from the generated `EventDecision` so backend shape changes propagate
 * automatically, but with timing fields narrowed to required `number` because
 * App.tsx fills in defaults when assembling the timeline.
 */
export type EventDecision = Omit<
  BackendEventDecision,
  "quantized_timestamp_ms" | "snap_delta_ms" | "grid_position"
> & {
  quantized_timestamp_ms: number;
  snap_delta_ms: number;
  grid_position?: string;
};

// For display purposes - map event classes to readable names
export const EVENT_CLASS_NAMES: Record<EventClass, string> = {
  BilabialPlosive: 'B/P (Kick)',
  HihatNoise: 'S/TS (Hi-hat)',
  Click: 'T/K (Snare)',
  HumVoiced: 'Hum (Pad)',
};

// Neo-brutalist color scheme for event classes
export const EVENT_CLASS_COLORS: Record<EventClass, string> = {
  BilabialPlosive: '#FF00FF', // Magenta
  HihatNoise: '#00FFFF',      // Cyan
  Click: '#00FF00',           // Green
  HumVoiced: '#FFFF00',       // Yellow
};
