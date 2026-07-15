// Event detection types + classification
//
// The offline "brain": event types, the heuristic (rule-based) classifier, and
// user calibration (kNN). Moved out of `src-tauri/src/events` so the same code
// backs both the native pipeline and the WASM worklet. The Tauri-adjacent pieces
// (`backend`, `explainability`) stay in the native crate; they depend on the
// arranger/groove layers that are not part of the DSP core.

pub mod calibration;
pub mod gaussian;
pub mod heuristic;
pub mod hybrid;
pub mod types;

pub use calibration::{CalibrationProfile, CalibrationSample, KnnClassifier};
pub use gaussian::{gaussian_features, GaussianModel, DEFAULT_MAP_TAU, GAUSSIAN_DIMS};
pub use heuristic::{ClassificationResult, ClassifierConfig, HeuristicClassifier};
pub use hybrid::{HybridClassifier, HUM_GATE_MAX_CREST, HUM_GATE_MAX_ZCR};
pub use types::{ClassScore, Event, EventClass, EventFeatures};
