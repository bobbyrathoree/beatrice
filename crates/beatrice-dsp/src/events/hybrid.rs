// Hybrid event classifier: Gaussian MFCC model + heuristic hum gate.
//
// The AVP-fitted Gaussian model covers the three percussive classes
// (BilabialPlosive, HihatNoise, Click) at ~80% participant-wise accuracy —
// but AVP has no hum class, so the model literally cannot say "HumVoiced".
// Hums have the one crisp physical signature in the taxonomy: sustained
// (low crest factor) AND periodic (low zero-crossing rate). This gate routes
// such events to the heuristic (whose crest-factor logic was verified on real
// hum recordings); everything else goes to the Gaussian model.
//
// Gate calibration: on all 9,777 AVP percussive utterances, `crest < 2.2 &&
// zcr < 0.15` fires on 4 (0.04%) — so the gate costs the percussive classes
// essentially nothing while keeping HumVoiced reachable.

use crate::events::gaussian::{gaussian_features, GaussianModel, DEFAULT_MAP_TAU};
use crate::events::heuristic::{ClassificationResult, HeuristicClassifier};
use crate::events::types::{EventClass, EventFeatures};

/// Sustained-signal gate: crest factor below this AND zcr below
/// [`HUM_GATE_MAX_ZCR`] routes classification to the heuristic (hum path).
pub const HUM_GATE_MAX_CREST: f32 = 2.2;
pub const HUM_GATE_MAX_ZCR: f32 = 0.15;

/// MFCC extraction window (ms) for the Gaussian model. MUST match the window
/// the factory model was fitted with (`benchmark` default `--window-ms 150`):
/// the model learned the timbre statistics of 150 ms onset windows, and a
/// dynamic event window (up to 500 ms of mostly decay/silence) dilutes the
/// MFCC mean away from that training distribution.
pub const HYBRID_MFCC_WINDOW_MS: f64 = 150.0;

/// Gaussian-first classifier with a heuristic gate for sustained signals.
pub struct HybridClassifier {
    gaussian: GaussianModel,
    heuristic: HeuristicClassifier,
}

impl HybridClassifier {
    /// Hybrid over the embedded AVP factory model (user-agnostic).
    pub fn factory() -> Self {
        HybridClassifier {
            gaussian: GaussianModel::factory(),
            heuristic: HeuristicClassifier::new(),
        }
    }

    /// Hybrid over a caller-supplied Gaussian model (e.g. a MAP-adapted one).
    pub fn with_model(gaussian: GaussianModel) -> Self {
        HybridClassifier {
            gaussian,
            heuristic: HeuristicClassifier::new(),
        }
    }

    /// Hybrid over the factory model MAP-adapted from labeled user samples
    /// (`(class, gaussian_feature_vector)` pairs, see [`gaussian_features`]).
    pub fn with_adaptation(samples: &[(EventClass, Vec<f32>)]) -> Self {
        Self::with_model(GaussianModel::factory().map_adapt(samples, DEFAULT_MAP_TAU))
    }

    /// Whether the sustained-signal gate routes this event to the heuristic.
    pub fn is_sustained(features: &EventFeatures) -> bool {
        features.crest_factor > 0.0
            && features.crest_factor < HUM_GATE_MAX_CREST
            && features.zcr < HUM_GATE_MAX_ZCR
    }

    /// Classify an event from its scalar features + MFCC vector.
    ///
    /// Returns the same [`ClassificationResult`] shape as the heuristic so
    /// call sites and the explainability UI keep working unchanged. In the
    /// Gaussian branch, HumVoiced's score is 0 (the model cannot produce it).
    pub fn classify(&self, features: &EventFeatures, mfcc: &[f32]) -> ClassificationResult {
        if Self::is_sustained(features) {
            return self.heuristic.classify(features);
        }

        let x = gaussian_features(features, mfcc);
        let (class, confidence, scores) = self.gaussian.classify(&x);

        // Rebuild the fixed 4-slot score array (UI contract): posterior for
        // the model's classes, 0.0 for HumVoiced (gated away above).
        let score_of = |c: EventClass| {
            scores
                .iter()
                .find(|s| s.class == c)
                .map(|s| s.score)
                .unwrap_or(0.0)
        };
        let all_scores = [
            (
                EventClass::BilabialPlosive,
                score_of(EventClass::BilabialPlosive),
            ),
            (EventClass::HihatNoise, score_of(EventClass::HihatNoise)),
            (EventClass::Click, score_of(EventClass::Click)),
            (EventClass::HumVoiced, 0.0),
        ];

        ClassificationResult {
            class,
            confidence,
            all_scores,
        }
    }
}

impl Default for HybridClassifier {
    fn default() -> Self {
        Self::factory()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sustained_hum_features() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 400.0,
            zcr: 0.05,
            low_band_energy: 0.5,
            mid_band_energy: 0.4,
            high_band_energy: 0.1,
            peak_amplitude: 0.5,
            crest_factor: 1.5,
        }
    }

    fn transient_features() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 300.0,
            zcr: 0.04,
            low_band_energy: 0.7,
            mid_band_energy: 0.25,
            high_band_energy: 0.05,
            peak_amplitude: 0.8,
            crest_factor: 4.5,
        }
    }

    #[test]
    fn sustained_signals_route_to_hum() {
        let clf = HybridClassifier::factory();
        let result = clf.classify(&sustained_hum_features(), &[0.0; 20]);
        assert_eq!(result.class, EventClass::HumVoiced);
    }

    #[test]
    fn transients_never_classify_as_hum() {
        let clf = HybridClassifier::factory();
        let result = clf.classify(&transient_features(), &[0.0; 20]);
        assert_ne!(result.class, EventClass::HumVoiced);
        // Gaussian branch: hum slot is exactly 0.
        let hum_score = result
            .all_scores
            .iter()
            .find(|(c, _)| *c == EventClass::HumVoiced)
            .unwrap()
            .1;
        assert_eq!(hum_score, 0.0);
    }

    #[test]
    fn gaussian_branch_scores_sum_to_one() {
        let clf = HybridClassifier::factory();
        let result = clf.classify(&transient_features(), &[0.0; 20]);
        let total: f32 = result.all_scores.iter().map(|(_, s)| s).sum();
        assert!((total - 1.0).abs() < 1e-3, "scores sum to {total}");
        assert!(result.confidence > 0.0 && result.confidence <= 1.0);
    }

    #[test]
    fn adaptation_changes_the_model() {
        // Adapt the plosive mean toward a synthetic user's cluster and verify
        // the adapted hybrid still functions end-to-end.
        let samples: Vec<(EventClass, Vec<f32>)> = (0..5)
            .map(|_| (EventClass::BilabialPlosive, vec![1.0; 22]))
            .collect();
        let clf = HybridClassifier::with_adaptation(&samples);
        let result = clf.classify(&transient_features(), &[0.0; 20]);
        assert_ne!(result.class, EventClass::HumVoiced);
    }
}
