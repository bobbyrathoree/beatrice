// Audio processing module
// Handles WAV file ingestion and audio data processing.
//
// Onset detection + feature extraction + the `AudioData` container now live in
// the shared `beatrice-dsp` crate. This module re-exports them so every existing
// `crate::audio::…` / `beatrice_lib::audio::…` path keeps resolving unchanged.

pub mod ingest;
pub mod recording;

// Re-export the DSP `features` module so `crate::audio::features::Onset`
// (used by the groove layer) and `beatrice_lib::audio::features` still resolve.
pub use beatrice_dsp::features;

pub use ingest::{ingest_wav, AudioData, AudioError};
pub use features::{
    detect_onsets, extract_features, extract_features_for_window, extract_mfcc,
    extract_mfcc_for_window, extract_mfcc_stats, Onset, OnsetConfig, MFCC_COEFFS,
};
pub use recording::{AudioRecorder, RecordingData, RecordingError};
