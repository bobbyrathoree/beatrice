// Classifier backend abstraction
// Supports multiple classification backends: Heuristic (MVP) and ONNX (future)

use crate::events::heuristic::{ClassificationResult, HeuristicClassifier};
use crate::events::types::EventFeatures;
use thiserror::Error;

/// Classification backend type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassifierBackend {
    /// Rule-based heuristic classifier (MVP)
    /// Uses hand-crafted feature rules for classification
    Heuristic,

    /// ONNX-based embedding model (future)
    /// Will use deep learning model for more accurate classification
    #[allow(dead_code)]
    Onnx,
}

/// Errors that can occur during classification
#[derive(Debug, Error)]
pub enum ClassifierError {
    #[error("Backend not implemented: {0:?}")]
    BackendNotImplemented(ClassifierBackend),

    #[error("Model loading failed: {0}")]
    ModelLoadError(String),

    #[error("Classification failed: {0}")]
    ClassificationError(String),
}

/// Unified classifier interface supporting multiple backends
pub struct Classifier {
    backend: ClassifierBackend,
    heuristic: Option<HeuristicClassifier>,
    // Future: onnx_model: Option<OnnxModel>,
}

impl Classifier {
    /// Create a new classifier with specified backend
    pub fn new(backend: ClassifierBackend) -> Result<Self, ClassifierError> {
        match backend {
            ClassifierBackend::Heuristic => {
                let heuristic = HeuristicClassifier::new();
                Ok(Classifier {
                    backend,
                    heuristic: Some(heuristic),
                })
            }
            ClassifierBackend::Onnx => {
                // ONNX backend not yet implemented
                Err(ClassifierError::BackendNotImplemented(backend))
            }
        }
    }

    /// Create a new heuristic classifier (convenience method)
    pub fn new_heuristic() -> Result<Self, ClassifierError> {
        Self::new(ClassifierBackend::Heuristic)
    }

    /// Classify event features using the selected backend
    pub fn classify(&self, features: &EventFeatures) -> Result<ClassificationResult, ClassifierError> {
        match self.backend {
            ClassifierBackend::Heuristic => {
                if let Some(ref classifier) = self.heuristic {
                    Ok(classifier.classify(features))
                } else {
                    Err(ClassifierError::ClassificationError(
                        "Heuristic classifier not initialized".to_string(),
                    ))
                }
            }
            ClassifierBackend::Onnx => {
                Err(ClassifierError::BackendNotImplemented(ClassifierBackend::Onnx))
            }
        }
    }

    /// Get the current backend type
    pub fn backend(&self) -> ClassifierBackend {
        self.backend
    }

    /// Check if ONNX backend is available (always false for now)
    pub fn is_onnx_available() -> bool {
        false
    }
}

impl Default for Classifier {
    fn default() -> Self {
        // Default to heuristic classifier
        Self::new_heuristic().expect("Failed to create heuristic classifier")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::types::{EventClass, EventFeatures};

    #[test]
    fn test_create_heuristic_classifier() {
        let classifier = Classifier::new(ClassifierBackend::Heuristic);
        assert!(classifier.is_ok());

        let classifier = classifier.unwrap();
        assert_eq!(classifier.backend(), ClassifierBackend::Heuristic);
    }

    #[test]
    fn test_create_onnx_classifier_fails() {
        let classifier = Classifier::new(ClassifierBackend::Onnx);
        assert!(classifier.is_err());
    }

    #[test]
    fn test_classify_with_heuristic() {
        let classifier = Classifier::new_heuristic().unwrap();

        let features = EventFeatures {
            spectral_centroid: 300.0,
            zcr: 0.08,
            low_band_energy: 0.7,
            mid_band_energy: 0.2,
            high_band_energy: 0.1,
        };

        let result = classifier.classify(&features);
        assert!(result.is_ok());

        let result = result.unwrap();
        assert_eq!(result.class, EventClass::BilabialPlosive);
    }

    #[test]
    fn test_onnx_not_available() {
        assert!(!Classifier::is_onnx_available());
    }

    #[test]
    fn test_default_classifier() {
        let classifier = Classifier::default();
        assert_eq!(classifier.backend(), ClassifierBackend::Heuristic);
    }
}
