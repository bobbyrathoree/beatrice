// Heuristic (rule-based) event classifier
// Classifies beatbox events using hand-crafted feature rules
// MVP implementation before ML-based classification

use crate::events::types::{EventClass, EventFeatures};

/// Classification result with confidence scores for each class
#[derive(Debug, Clone)]
pub struct ClassificationResult {
    /// Most likely event class
    pub class: EventClass,

    /// Confidence score for the selected class [0.0, 1.0]
    pub confidence: f32,

    /// Confidence scores for all classes (for debugging/visualization)
    pub all_scores: [(EventClass, f32); 4],
}

/// Rule-based classifier using spectral and temporal features
pub struct HeuristicClassifier {
    /// Feature weight configuration
    config: ClassifierConfig,
}

/// Configuration for classifier feature weights and thresholds
#[derive(Debug, Clone)]
pub struct ClassifierConfig {
    /// Weight for spectral centroid in classification [0.0, 1.0]
    pub centroid_weight: f32,

    /// Weight for zero-crossing rate in classification [0.0, 1.0]
    pub zcr_weight: f32,

    /// Weight for band energy ratios in classification [0.0, 1.0]
    pub energy_weight: f32,
}

impl Default for ClassifierConfig {
    fn default() -> Self {
        ClassifierConfig {
            centroid_weight: 1.0,
            zcr_weight: 1.0,
            energy_weight: 1.5, // Energy bands are most discriminative
        }
    }
}

impl HeuristicClassifier {
    /// Create a new heuristic classifier with default configuration
    pub fn new() -> Self {
        HeuristicClassifier {
            config: ClassifierConfig::default(),
        }
    }

    /// Create a classifier with custom configuration
    pub fn with_config(config: ClassifierConfig) -> Self {
        HeuristicClassifier { config }
    }

    /// Classify an event based on its features
    /// Returns the most likely class and confidence scores
    pub fn classify(&self, features: &EventFeatures) -> ClassificationResult {
        // Calculate confidence scores for each class
        let bilabial_score = self.score_bilabial_plosive(features);
        let hihat_score = self.score_hihat_noise(features);
        let click_score = self.score_click(features);
        let hum_score = self.score_hum_voiced(features);

        let all_scores = [
            (EventClass::BilabialPlosive, bilabial_score),
            (EventClass::HihatNoise, hihat_score),
            (EventClass::Click, click_score),
            (EventClass::HumVoiced, hum_score),
        ];

        // Find the class with highest score
        let (class, confidence) = all_scores
            .iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .copied()
            .unwrap();

        ClassificationResult {
            class,
            confidence,
            all_scores,
        }
    }

    /// Score for BilabialPlosive (B/P sounds → kick + synth bass)
    /// Characteristics:
    /// - Low spectral centroid (< 800 Hz - relaxed for vowel formants)
    /// - Strong low-band energy (> 0.35 - realistic for "ba" with vowel)
    /// - Low to moderate ZCR (voiced but with attack)
    fn score_bilabial_plosive(&self, f: &EventFeatures) -> f32 {
        let mut score = 0.0;

        // Spectral centroid - relaxed thresholds for real "ba" sounds
        // Real B-sounds have formants that push centroid higher (400-800 Hz typical)
        let centroid_score = if f.spectral_centroid < 500.0 {
            1.0
        } else if f.spectral_centroid < 800.0 {
            0.9
        } else if f.spectral_centroid < 1200.0 {
            0.7
        } else if f.spectral_centroid < 1800.0 {
            0.4
        } else {
            0.1
        };
        score += centroid_score * self.config.centroid_weight;

        // Low-band energy - adjusted for real "ba" (vowels split energy)
        // Real "ba" has low_band ~0.35-0.5 because formants are in mid band
        let low_energy_score = if f.low_band_energy > 0.45 {
            1.0
        } else if f.low_band_energy > 0.35 {
            0.9
        } else if f.low_band_energy > 0.25 {
            0.6
        } else {
            0.2
        };
        score += low_energy_score * self.config.energy_weight;

        // ZCR - should be low to moderate
        let zcr_score = if f.zcr < 0.1 {
            1.0
        } else if f.zcr < 0.15 {
            0.85
        } else if f.zcr < 0.25 {
            0.5
        } else {
            0.2
        };
        score += zcr_score * self.config.zcr_weight;

        // Bonus: If low + mid is strong (typical for "ba"), boost score
        if f.low_band_energy + f.mid_band_energy > 0.7 && f.high_band_energy < 0.3 {
            score += 0.3;
        }

        // Normalize by total weight (plus bonus possibility)
        let total_weight = self.config.centroid_weight
            + self.config.energy_weight
            + self.config.zcr_weight;

        (score / total_weight).min(1.0).max(0.0)
    }

    /// Score for HihatNoise (S/SH/TS sounds → hi-hats)
    /// Characteristics:
    /// - High spectral centroid (> 3000 Hz)
    /// - High ZCR (> 0.3)
    /// - Strong high-band energy (> 0.5)
    /// - Low low-band energy
    fn score_hihat_noise(&self, f: &EventFeatures) -> f32 {
        let mut score = 0.0;

        // Spectral centroid - prefer high frequencies
        let centroid_score = if f.spectral_centroid > 4000.0 {
            1.0
        } else if f.spectral_centroid > 3000.0 {
            0.8
        } else if f.spectral_centroid > 2000.0 {
            0.5
        } else {
            0.1
        };
        score += centroid_score * self.config.centroid_weight;

        // High-band energy - should be dominant
        let high_energy_score = if f.high_band_energy > 0.5 {
            1.0
        } else if f.high_band_energy > 0.3 {
            0.7
        } else {
            0.2
        };
        score += high_energy_score * self.config.energy_weight;

        // ZCR - should be high (noisy content)
        let zcr_score = if f.zcr > 0.4 {
            1.0
        } else if f.zcr > 0.3 {
            0.8
        } else if f.zcr > 0.2 {
            0.5
        } else {
            0.2
        };
        score += zcr_score * self.config.zcr_weight;

        // Normalize by total weight
        let total_weight = self.config.centroid_weight
            + self.config.energy_weight
            + self.config.zcr_weight;

        (score / total_weight).min(1.0).max(0.0)
    }

    /// Score for Click (T/K sounds → snares/claps)
    /// Characteristics:
    /// - Mid-range spectral centroid (1000-2500 Hz)
    /// - Moderate to high ZCR
    /// - Strong mid-band energy
    /// - Sharp transient (not directly measurable with these features)
    fn score_click(&self, f: &EventFeatures) -> f32 {
        let mut score = 0.0;

        // Spectral centroid - prefer mid-range
        let centroid_score = if f.spectral_centroid > 1000.0 && f.spectral_centroid < 2500.0 {
            1.0
        } else if f.spectral_centroid > 800.0 && f.spectral_centroid < 3000.0 {
            0.7
        } else if f.spectral_centroid > 500.0 && f.spectral_centroid < 4000.0 {
            0.4
        } else {
            0.1
        };
        score += centroid_score * self.config.centroid_weight;

        // Mid-band energy - should be significant
        let mid_energy_score = if f.mid_band_energy > 0.4 {
            1.0
        } else if f.mid_band_energy > 0.3 {
            0.7
        } else {
            0.3
        };
        score += mid_energy_score * self.config.energy_weight;

        // ZCR - moderate to high
        let zcr_score = if f.zcr > 0.2 && f.zcr < 0.5 {
            1.0
        } else if f.zcr > 0.15 {
            0.7
        } else {
            0.3
        };
        score += zcr_score * self.config.zcr_weight;

        // Normalize by total weight
        let total_weight = self.config.centroid_weight
            + self.config.energy_weight
            + self.config.zcr_weight;

        (score / total_weight).min(1.0).max(0.0)
    }

    /// Score for HumVoiced (vowels/tones → pads/bass)
    /// Characteristics:
    /// - Variable spectral centroid (depends on pitch)
    /// - Low ZCR (< 0.15) - periodic/harmonic content
    /// - Sustained energy across time
    /// - Not strongly concentrated in any single band
    fn score_hum_voiced(&self, f: &EventFeatures) -> f32 {
        let mut score = 0.0;

        // ZCR - should be low (harmonic content)
        let zcr_score = if f.zcr < 0.1 {
            1.0
        } else if f.zcr < 0.15 {
            0.8
        } else if f.zcr < 0.25 {
            0.5
        } else {
            0.2
        };
        score += zcr_score * self.config.zcr_weight;

        // Energy distribution - prefer more balanced (not too concentrated)
        let energy_balance = 1.0 - (f.low_band_energy - 0.33).abs()
            - (f.mid_band_energy - 0.33).abs()
            - (f.high_band_energy - 0.33).abs();
        let balance_score = energy_balance.max(0.0);
        score += balance_score * self.config.energy_weight;

        // Centroid - prefer mid-low range (typical voice fundamental)
        let centroid_score = if f.spectral_centroid > 200.0 && f.spectral_centroid < 1000.0 {
            1.0
        } else if f.spectral_centroid < 1500.0 {
            0.7
        } else {
            0.4
        };
        score += centroid_score * self.config.centroid_weight;

        // Normalize by total weight
        let total_weight = self.config.centroid_weight
            + self.config.energy_weight
            + self.config.zcr_weight;

        let mut final_score = (score / total_weight).min(1.0).max(0.0);

        // Penalty: If low-band is dominant (> 0.4) with low centroid,
        // this is likely a plosive, not a hum - reduce HumVoiced score
        if f.low_band_energy > 0.4 && f.spectral_centroid < 800.0 {
            final_score *= 0.6; // 40% penalty
        }

        // Penalty: If energy is concentrated in low+mid (typical plosive pattern)
        if f.low_band_energy + f.mid_band_energy > 0.75 && f.high_band_energy < 0.25 {
            final_score *= 0.7; // 30% penalty
        }

        final_score
    }
}

impl Default for HeuristicClassifier {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bilabial_classification() {
        let classifier = HeuristicClassifier::new();

        // Create features typical of B/P sound
        let features = EventFeatures {
            spectral_centroid: 300.0,
            zcr: 0.08,
            low_band_energy: 0.7,
            mid_band_energy: 0.2,
            high_band_energy: 0.1,
            peak_amplitude: 0.8,
        };

        let result = classifier.classify(&features);
        assert_eq!(result.class, EventClass::BilabialPlosive);
        assert!(result.confidence > 0.7);
    }

    #[test]
    fn test_hihat_classification() {
        let classifier = HeuristicClassifier::new();

        // Create features typical of hi-hat
        let features = EventFeatures {
            spectral_centroid: 4500.0,
            zcr: 0.45,
            low_band_energy: 0.05,
            mid_band_energy: 0.25,
            high_band_energy: 0.7,
            peak_amplitude: 0.6,
        };

        let result = classifier.classify(&features);
        assert_eq!(result.class, EventClass::HihatNoise);
        assert!(result.confidence > 0.7);
    }

    #[test]
    fn test_click_classification() {
        let classifier = HeuristicClassifier::new();

        // Create features typical of T/K click
        let features = EventFeatures {
            spectral_centroid: 1800.0,
            zcr: 0.3,
            low_band_energy: 0.2,
            mid_band_energy: 0.6,
            high_band_energy: 0.2,
            peak_amplitude: 0.7,
        };

        let result = classifier.classify(&features);
        assert_eq!(result.class, EventClass::Click);
        assert!(result.confidence > 0.6);
    }

    #[test]
    fn test_hum_classification() {
        let classifier = HeuristicClassifier::new();

        // Create features typical of voiced hum - balanced energy distribution
        // (not low-band dominant like plosives)
        let features = EventFeatures {
            spectral_centroid: 600.0,  // Mid-range typical of voice
            zcr: 0.05,                 // Low ZCR for harmonic content
            low_band_energy: 0.3,      // Balanced - not dominant
            mid_band_energy: 0.45,     // Mid-band dominant (voice formants)
            high_band_energy: 0.25,    // Some high harmonics
            peak_amplitude: 0.5,
        };

        let result = classifier.classify(&features);
        assert_eq!(result.class, EventClass::HumVoiced);
        assert!(result.confidence > 0.5);
    }

    #[test]
    fn test_realistic_ba_sound() {
        let classifier = HeuristicClassifier::new();

        // Realistic "ba" sound features from actual recordings
        // - Higher centroid than pure low-freq due to vowel formants
        // - Strong but not dominant low-band energy
        // - Significant mid-band energy from vowel
        let features = EventFeatures {
            spectral_centroid: 650.0,  // Pushed up by vowel formants
            zcr: 0.09,                 // Low but not zero
            low_band_energy: 0.42,     // Strong but not dominant
            mid_band_energy: 0.40,     // Vowel formants
            high_band_energy: 0.18,    // Some high harmonics
            peak_amplitude: 0.75,
        };

        let result = classifier.classify(&features);
        assert_eq!(result.class, EventClass::BilabialPlosive);
        assert!(result.confidence > 0.6);
    }

    #[test]
    fn test_all_scores_sum() {
        let classifier = HeuristicClassifier::new();

        let features = EventFeatures {
            spectral_centroid: 1000.0,
            zcr: 0.2,
            low_band_energy: 0.3,
            mid_band_energy: 0.4,
            high_band_energy: 0.3,
            peak_amplitude: 0.6,
        };

        let result = classifier.classify(&features);

        // All scores should be between 0 and 1
        for (_class, score) in result.all_scores.iter() {
            assert!(*score >= 0.0 && *score <= 1.0);
        }
    }
}
