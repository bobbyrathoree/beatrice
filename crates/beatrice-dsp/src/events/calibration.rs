// User calibration for personalized event detection
// "Teach Beatrice your BA" - store user's sample features for KNN-style matching

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::events::types::{EventClass, EventFeatures};

/// Current calibration profile schema version. v1 = pre-MFCC (7 scalar
/// features only); v2 = samples carry 20 mean MFCCs for Gaussian MAP
/// adaptation. Absent version key deserializes as 1 (legacy).
pub const PROFILE_VERSION: u32 = 2;

fn default_profile_version() -> u32 {
    1
}

/// A single calibration sample from the user
/// Contains features and raw audio window for potential future training
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationSample {
    /// The labeled class for this sample
    pub class: EventClass,

    /// Extracted features from this sample
    pub features: EventFeatures,

    /// Raw audio window (mono, normalized [-1, 1])
    /// Stored for future ML training data collection
    /// Hidden feature: users contribute training data
    pub raw_window: Vec<f32>,

    /// Sample rate of the raw window
    pub sample_rate: u32,

    /// Mean MFCCs (c1..c20) of the sample's feature window, used by the
    /// Gaussian model's MAP adaptation. `serde(default)` so profiles persisted
    /// before this field existed still load (they adapt from scalar features
    /// only if empty — see `gaussian_vec`).
    #[serde(default)]
    pub mfcc: Vec<f32>,

    /// Optional user notes about this sample
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CalibrationSample {
    /// Create a new calibration sample
    pub fn new(
        class: EventClass,
        features: EventFeatures,
        raw_window: Vec<f32>,
        sample_rate: u32,
    ) -> Self {
        // Derive MFCCs from the raw window when present so the Gaussian
        // MAP adaptation has the full feature vector to work with.
        let mfcc = if raw_window.is_empty() {
            Vec::new()
        } else {
            crate::features::extract_mfcc(&raw_window, sample_rate)
        };
        CalibrationSample {
            class,
            features,
            raw_window,
            sample_rate,
            mfcc,
            notes: None,
        }
    }

    /// Create a sample with an explicit MFCC vector (when the caller already
    /// extracted it, e.g. the streaming detector's classification window).
    pub fn with_mfcc(
        class: EventClass,
        features: EventFeatures,
        mfcc: Vec<f32>,
        raw_window: Vec<f32>,
        sample_rate: u32,
    ) -> Self {
        CalibrationSample {
            class,
            features,
            raw_window,
            sample_rate,
            mfcc,
            notes: None,
        }
    }

    /// Create a sample with notes
    pub fn with_notes(
        class: EventClass,
        features: EventFeatures,
        raw_window: Vec<f32>,
        sample_rate: u32,
        notes: String,
    ) -> Self {
        let mut s = Self::new(class, features, raw_window, sample_rate);
        s.notes = Some(notes);
        s
    }

    /// The sample's feature vector for the Gaussian model
    /// ([`crate::events::gaussian::gaussian_features`] layout). Zero-pads the
    /// MFCC block for legacy samples persisted without MFCCs.
    pub fn gaussian_vec(&self) -> Vec<f32> {
        crate::events::gaussian::gaussian_features(&self.features, &self.mfcc)
    }

    /// Whether this sample carries the full MFCC vector the Gaussian MAP
    /// adaptation needs. Legacy (v1) samples have an empty `mfcc`; adapting
    /// from their zero-padded vectors would drag the class means toward a
    /// spurious all-MFCC-zero point, so consumers must skip them.
    pub fn has_mfcc(&self) -> bool {
        self.mfcc.len() == crate::features::MFCC_COEFFS
    }
}

/// User calibration profile containing samples for all event classes
/// Used for personalized KNN-style classification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationProfile {
    /// Profile name (e.g., "John's Beatbox Style")
    pub name: String,

    /// Samples grouped by event class
    pub samples: HashMap<EventClass, Vec<CalibrationSample>>,

    /// Profile schema version ([`PROFILE_VERSION`]). `serde(default)` maps a
    /// missing key to 1 (legacy, pre-MFCC) instead of failing to load.
    #[serde(default = "default_profile_version")]
    pub version: u32,

    /// Creation timestamp (ISO 8601)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    /// Optional profile notes
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CalibrationProfile {
    /// Create a new empty calibration profile
    pub fn new(name: String) -> Self {
        CalibrationProfile {
            name,
            samples: HashMap::new(),
            version: PROFILE_VERSION,
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            notes: None,
        }
    }

    /// Add a calibration sample to the profile
    pub fn add_sample(&mut self, sample: CalibrationSample) {
        self.samples
            .entry(sample.class)
            .or_default()
            .push(sample);
    }

    /// Get all samples for a specific event class
    pub fn get_samples(&self, class: EventClass) -> Option<&Vec<CalibrationSample>> {
        self.samples.get(&class)
    }

    /// Get the total number of samples across all classes
    pub fn total_samples(&self) -> usize {
        self.samples.values().map(|v| v.len()).sum()
    }

    /// Check if the profile has sufficient samples for calibration
    /// Recommended: at least 5 samples per class
    pub fn is_sufficient(&self) -> bool {
        let min_samples_per_class = 5;

        // Check all four classes
        let required_classes = [
            EventClass::BilabialPlosive,
            EventClass::HihatNoise,
            EventClass::Click,
            EventClass::HumVoiced,
        ];

        for class in required_classes.iter() {
            let count = self.samples.get(class).map(|v| v.len()).unwrap_or(0);
            if count < min_samples_per_class {
                return false;
            }
        }

        true
    }

    /// Serialize profile to JSON bytes
    pub fn to_json_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec_pretty(self)
    }

    /// Deserialize profile from JSON bytes
    pub fn from_json_bytes(data: &[u8]) -> Result<Self, serde_json::Error> {
        serde_json::from_slice(data)
    }
}

/// K-Nearest Neighbors classifier using calibration samples
pub struct KnnClassifier {
    profile: CalibrationProfile,
    k: usize,
}

impl KnnClassifier {
    /// Create a new KNN classifier with a calibration profile
    /// k: number of nearest neighbors to consider (default: 5)
    pub fn new(profile: CalibrationProfile, k: usize) -> Self {
        KnnClassifier { profile, k }
    }

    /// Classify features using KNN against calibration samples
    /// Returns the most common class among k nearest neighbors
    pub fn classify(&self, features: &EventFeatures) -> Option<(EventClass, f32)> {
        // Collect all samples with their distances
        let mut distances: Vec<(EventClass, f32)> = Vec::new();

        for (class, samples) in self.profile.samples.iter() {
            for sample in samples.iter() {
                let distance = features.distance_to(&sample.features);
                distances.push((*class, distance));
            }
        }

        if distances.is_empty() {
            return None;
        }

        // Sort by distance (ascending)
        distances.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        // Take k nearest neighbors
        let k_nearest = distances.iter().take(self.k);

        // Count votes for each class
        let mut votes: HashMap<EventClass, usize> = HashMap::new();
        for (class, _distance) in k_nearest {
            *votes.entry(*class).or_insert(0) += 1;
        }

        // Find class with most votes
        let (best_class, vote_count) = votes
            .into_iter()
            .max_by_key(|(_, count)| *count)?;

        // Calculate confidence as vote ratio
        let confidence = vote_count as f32 / self.k.min(distances.len()) as f32;

        Some((best_class, confidence))
    }

    /// Get the calibration profile
    pub fn profile(&self) -> &CalibrationProfile {
        &self.profile
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_features(centroid: f32, zcr: f32) -> EventFeatures {
        EventFeatures {
            spectral_centroid: centroid,
            zcr,
            low_band_energy: 0.5,
            mid_band_energy: 0.3,
            high_band_energy: 0.2,
            peak_amplitude: 0.5, crest_factor: 3.0,
        }
    }

    #[test]
    fn test_calibration_sample_creation() {
        let features = create_test_features(1000.0, 0.1);
        let sample = CalibrationSample::new(
            EventClass::BilabialPlosive,
            features,
            vec![0.1, 0.2, 0.3],
            44100,
        );

        assert_eq!(sample.class, EventClass::BilabialPlosive);
        assert_eq!(sample.sample_rate, 44100);
        assert_eq!(sample.raw_window.len(), 3);
    }

    #[test]
    fn test_calibration_profile_creation() {
        let profile = CalibrationProfile::new("Test Profile".to_string());

        assert_eq!(profile.name, "Test Profile");
        assert_eq!(profile.total_samples(), 0);
        assert!(!profile.is_sufficient());
    }

    #[test]
    fn test_add_samples_to_profile() {
        let mut profile = CalibrationProfile::new("Test".to_string());

        let features = create_test_features(1000.0, 0.1);
        let sample = CalibrationSample::new(
            EventClass::BilabialPlosive,
            features,
            vec![],
            44100,
        );

        profile.add_sample(sample);

        assert_eq!(profile.total_samples(), 1);
        assert!(profile.get_samples(EventClass::BilabialPlosive).is_some());
    }

    #[test]
    fn test_profile_sufficiency() {
        let mut profile = CalibrationProfile::new("Test".to_string());

        // Add 5 samples for each class
        for class in [
            EventClass::BilabialPlosive,
            EventClass::HihatNoise,
            EventClass::Click,
            EventClass::HumVoiced,
        ]
        .iter()
        {
            for _ in 0..5 {
                let features = create_test_features(1000.0, 0.1);
                let sample = CalibrationSample::new(*class, features, vec![], 44100);
                profile.add_sample(sample);
            }
        }

        assert!(profile.is_sufficient());
        assert_eq!(profile.total_samples(), 20);
    }

    #[test]
    fn test_knn_classification() {
        let mut profile = CalibrationProfile::new("Test".to_string());

        // Add samples with distinct features for BilabialPlosive (low centroid)
        for _ in 0..5 {
            let features = create_test_features(300.0, 0.05);
            let sample = CalibrationSample::new(
                EventClass::BilabialPlosive,
                features,
                vec![],
                44100,
            );
            profile.add_sample(sample);
        }

        // Add samples for HihatNoise (high centroid)
        for _ in 0..5 {
            let features = create_test_features(4000.0, 0.4);
            let sample = CalibrationSample::new(EventClass::HihatNoise, features, vec![], 44100);
            profile.add_sample(sample);
        }

        let classifier = KnnClassifier::new(profile, 3);

        // Test with features similar to BilabialPlosive
        let test_features = create_test_features(320.0, 0.06);
        let result = classifier.classify(&test_features);

        assert!(result.is_some());
        let (class, confidence) = result.unwrap();
        assert_eq!(class, EventClass::BilabialPlosive);
        assert!(confidence > 0.5);
    }

    #[test]
    fn profile_without_version_key_still_loads() {
        // Legacy profiles predate the version field; serde must default, not fail.
        let json = br#"{"name":"old","samples":{}}"#;
        let p = CalibrationProfile::from_json_bytes(json).expect("legacy profile must load");
        assert_eq!(p.version, 1, "absent version key means schema v1");
    }

    #[test]
    fn has_mfcc_requires_full_vector() {
        let f = create_test_features(1000.0, 0.1);
        let legacy = CalibrationSample::with_mfcc(EventClass::Click, f.clone(), vec![], vec![], 44100);
        assert!(!legacy.has_mfcc());
        let partial = CalibrationSample::with_mfcc(EventClass::Click, f.clone(), vec![0.1; 5], vec![], 44100);
        assert!(!partial.has_mfcc());
        let full = CalibrationSample::with_mfcc(EventClass::Click, f, vec![0.1; 20], vec![], 44100);
        assert!(full.has_mfcc());
    }

    #[test]
    fn test_profile_serialization() {
        let mut profile = CalibrationProfile::new("Test".to_string());

        let features = create_test_features(1000.0, 0.1);
        let sample = CalibrationSample::new(EventClass::Click, features, vec![0.5], 44100);
        profile.add_sample(sample);

        // Serialize to JSON
        let json_bytes = profile.to_json_bytes();
        assert!(json_bytes.is_ok());

        // Deserialize back
        let deserialized = CalibrationProfile::from_json_bytes(&json_bytes.unwrap());
        assert!(deserialized.is_ok());

        let profile2 = deserialized.unwrap();
        assert_eq!(profile2.name, profile.name);
        assert_eq!(profile2.total_samples(), profile.total_samples());
    }
}
