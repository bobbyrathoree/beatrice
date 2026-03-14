// Types for explainability components - showing AI decision-making process

import type { EventFeatures } from './visualization';

export type EventClass = 'BilabialPlosive' | 'HihatNoise' | 'Click' | 'HumVoiced';

export interface AssignedNote {
  lane_name: string;
  midi_note: number;
  velocity: number;
  duration_ms: number;
}

export interface EventDecision {
  event_id: string;
  timestamp_ms: number;
  duration_ms: number;
  class: EventClass;
  confidence: number;
  features: EventFeatures;
  quantized_timestamp_ms?: number;
  snap_delta_ms?: number;
  grid_position?: string;
  assigned_notes: AssignedNote[];
  reasoning: string;
}

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
