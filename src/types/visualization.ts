// Types for 3D visualization components

export interface DetectedEvent {
  id: string;
  timestamp_ms: number;
  duration_ms: number;
  class: 'BilabialPlosive' | 'HihatNoise' | 'Click' | 'HumVoiced';
  confidence: number;
}
