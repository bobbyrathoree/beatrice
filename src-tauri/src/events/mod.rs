// Event detection module
// Onset detection, feature extraction, and event classification.
//
// The event types, heuristic classifier, and calibration (kNN) now live in the
// shared `beatrice-dsp` crate. This module re-exports them — including the
// submodules `types`, `heuristic`, and `calibration`, so paths like
// `crate::events::heuristic::ClassificationResult` keep resolving — and keeps
// the Tauri-adjacent `backend`/`explainability` pieces here.

// Re-export the DSP event submodules so existing `crate::events::{types,
// heuristic, calibration}::…` paths still resolve.
pub use beatrice_dsp::events::{calibration, heuristic, types};

pub mod backend;
pub mod explainability;

pub use backend::{Classifier, ClassifierBackend, ClassifierError};
pub use calibration::{CalibrationProfile, CalibrationSample, KnnClassifier};
pub use heuristic::{ClassificationResult, ClassifierConfig, HeuristicClassifier};
pub use types::{ClassScore, Event, EventClass, EventFeatures};
pub use explainability::{EventDecision, AssignedNote};
