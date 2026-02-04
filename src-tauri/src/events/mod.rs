// Event detection module
// Onset detection, feature extraction, and event classification

pub mod backend;
pub mod calibration;
pub mod heuristic;
pub mod types;

pub use backend::{Classifier, ClassifierBackend, ClassifierError};
pub use calibration::{CalibrationProfile, CalibrationSample, KnnClassifier};
pub use heuristic::{ClassificationResult, ClassifierConfig, HeuristicClassifier};
pub use types::{Event, EventClass, EventFeatures};
pub mod explainability;
pub use explainability::{EventDecision, AssignedNote};
