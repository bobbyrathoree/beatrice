// Event detection types
// Defines event classes, event data structures, and feature representations

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Classification of detected beatbox events
/// Maps beatbox sounds to musical instruments/synthesis targets
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventClass {
    /// B/P sounds - bilabial plosives
    /// Triggers: synth bass + kick drum
    /// Characteristics: Low frequency, sharp attack, strong low-mid energy
    BilabialPlosive,

    /// S/SH/TS sounds - high-frequency noise
    /// Triggers: hi-hats, cymbals
    /// Characteristics: High spectral centroid, high ZCR, strong high-frequency energy
    HihatNoise,

    /// T/K sounds - dental/velar plosives
    /// Triggers: snares, claps, rimshots
    /// Characteristics: Mid spectral centroid, sharp transient, mid-band energy
    Click,

    /// Vowel sounds, humming, voiced tones
    /// Triggers: pads, bass lines, melodic elements
    /// Characteristics: Sustained energy, lower ZCR, periodic/harmonic content
    HumVoiced,
}

impl EventClass {
    /// Convert from string representation (for serialization)
    /// Accepts both PascalCase and snake_case for backwards compatibility
    pub fn from_string(s: &str) -> Self {
        match s {
            "BilabialPlosive" | "bilabial_plosive" => EventClass::BilabialPlosive,
            "HihatNoise" | "hihat_noise" => EventClass::HihatNoise,
            "Click" | "click" => EventClass::Click,
            "HumVoiced" | "hum_voiced" => EventClass::HumVoiced,
            _ => EventClass::Click, // Default fallback
        }
    }

    /// Convert to string representation (PascalCase for TypeScript compatibility)
    pub fn to_string(&self) -> &'static str {
        match self {
            EventClass::BilabialPlosive => "BilabialPlosive",
            EventClass::HihatNoise => "HihatNoise",
            EventClass::Click => "Click",
            EventClass::HumVoiced => "HumVoiced",
        }
    }

    /// Human-readable name for UI display
    pub fn display_name(&self) -> &'static str {
        match self {
            EventClass::BilabialPlosive => "B/P (Kick)",
            EventClass::HihatNoise => "S/TS (Hi-hat)",
            EventClass::Click => "T/K (Snare)",
            EventClass::HumVoiced => "Hum (Pad)",
        }
    }
}

/// Spectral and temporal features extracted from an audio segment
/// Used for classification and calibration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFeatures {
    /// Spectral centroid (Hz) - "center of mass" of spectrum
    /// Higher values indicate brighter/higher-pitched sounds
    pub spectral_centroid: f32,

    /// Zero-crossing rate (crossings per sample)
    /// Higher values indicate noisy/unvoiced content
    pub zcr: f32,

    /// Energy in low frequency band (0-200 Hz)
    /// Normalized to [0, 1] relative to total energy
    pub low_band_energy: f32,

    /// Energy in mid frequency band (200-2000 Hz)
    /// Normalized to [0, 1] relative to total energy
    pub mid_band_energy: f32,

    /// Energy in high frequency band (2000+ Hz)
    /// Normalized to [0, 1] relative to total energy
    pub high_band_energy: f32,
}

impl EventFeatures {
    /// Create features with all zeros (for initialization)
    pub fn zero() -> Self {
        EventFeatures {
            spectral_centroid: 0.0,
            zcr: 0.0,
            low_band_energy: 0.0,
            mid_band_energy: 0.0,
            high_band_energy: 0.0,
        }
    }

    /// Calculate Euclidean distance to another feature vector
    /// Used for KNN-style matching in calibration
    pub fn distance_to(&self, other: &EventFeatures) -> f32 {
        let d_centroid = (self.spectral_centroid - other.spectral_centroid) / 5000.0; // Normalize to ~[0,1]
        let d_zcr = self.zcr - other.zcr;
        let d_low = self.low_band_energy - other.low_band_energy;
        let d_mid = self.mid_band_energy - other.mid_band_energy;
        let d_high = self.high_band_energy - other.high_band_energy;

        (d_centroid * d_centroid
            + d_zcr * d_zcr
            + d_low * d_low
            + d_mid * d_mid
            + d_high * d_high)
            .sqrt()
    }
}

/// A detected beatbox event with timing, classification, and features
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Unique identifier for this event
    pub id: Uuid,

    /// Timestamp in milliseconds from start of audio
    pub timestamp_ms: f64,

    /// Duration of event in milliseconds
    /// Calculated from onset to next onset or energy decay
    pub duration_ms: f64,

    /// Classified event type
    pub class: EventClass,

    /// Classification confidence score [0.0, 1.0]
    /// Higher values indicate stronger feature match
    pub confidence: f32,

    /// Extracted audio features used for classification
    pub features: EventFeatures,
}

impl Event {
    /// Create a new event with generated UUID
    pub fn new(
        timestamp_ms: f64,
        duration_ms: f64,
        class: EventClass,
        confidence: f32,
        features: EventFeatures,
    ) -> Self {
        Event {
            id: Uuid::new_v4(),
            timestamp_ms,
            duration_ms,
            class,
            confidence,
            features,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_class_round_trip() {
        let class = EventClass::BilabialPlosive;
        let s = class.to_string();
        let parsed = EventClass::from_string(s);
        assert_eq!(class, parsed);
    }

    #[test]
    fn test_feature_distance() {
        let f1 = EventFeatures {
            spectral_centroid: 1000.0,
            zcr: 0.1,
            low_band_energy: 0.5,
            mid_band_energy: 0.3,
            high_band_energy: 0.2,
        };

        let f2 = EventFeatures {
            spectral_centroid: 1000.0,
            zcr: 0.1,
            low_band_energy: 0.5,
            mid_band_energy: 0.3,
            high_band_energy: 0.2,
        };

        // Identical features should have zero distance
        assert!(f1.distance_to(&f2) < 0.001);
    }

    #[test]
    fn test_event_creation() {
        let features = EventFeatures::zero();
        let event = Event::new(100.0, 50.0, EventClass::Click, 0.9, features);

        assert_eq!(event.timestamp_ms, 100.0);
        assert_eq!(event.duration_ms, 50.0);
        assert_eq!(event.class, EventClass::Click);
        assert_eq!(event.confidence, 0.9);
    }
}
