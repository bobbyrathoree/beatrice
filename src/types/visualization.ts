// Types for 3D visualization components

export interface EventFeatures {
  spectral_centroid: number;
  zcr: number;
  low_band_energy: number;
  mid_band_energy: number;
  high_band_energy: number;
}

export interface DetectedEvent {
  id: string;
  timestamp_ms: number;
  duration_ms: number;
  class: 'BilabialPlosive' | 'HihatNoise' | 'Click' | 'HumVoiced';
  confidence: number;
  features: EventFeatures;
}
