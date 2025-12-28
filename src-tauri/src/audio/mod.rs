// Audio processing module
// Handles WAV file ingestion and audio data processing

pub mod features;
pub mod ingest;

pub use ingest::{ingest_wav, AudioData, AudioError};
pub use features::{detect_onsets, extract_features, extract_features_for_window, Onset, OnsetConfig};
