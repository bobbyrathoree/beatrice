//! beatrice-dsp — the shared offline DSP core.
//!
//! This crate owns the deterministic "what" of Beatrice's analysis pipeline:
//! audio ingest container ([`ingest::AudioData`]), spectral onset detection +
//! feature extraction ([`features`]), event types and classification
//! ([`events`]), and the streaming [`SpikeDetector`] used by the WASM worklet.
//! It is pure Rust with no Tauri dependency, so the identical code compiles for
//! the native desktop app (`beatrice`, via `features = ["specta"]`) and for the
//! browser AudioWorklet (`wasm-pack build --features wasm`).
//!
//! The native `beatrice` crate consumes this crate and re-exports its modules
//! through thin shims (`beatrice_lib::audio::features`, `beatrice_lib::events`)
//! so every existing call site keeps compiling unchanged.

pub mod events;
pub mod features;
pub mod ingest;

pub use events::{
    CalibrationProfile, CalibrationSample, ClassScore, ClassificationResult, ClassifierConfig,
    Event, EventClass, EventFeatures, HeuristicClassifier, KnnClassifier,
};
pub use features::{detect_onsets, extract_features, extract_features_for_window, Onset, OnsetConfig};
pub use ingest::AudioData;

/// Run the offline heuristic analysis pipeline over decoded audio.
///
/// This is the single home for the detect-onsets → per-onset feature-extraction →
/// heuristic-classify loop that was duplicated in `commands.rs` (`detect_events`,
/// heuristic path), the `analyze` CLI bin, and the pipeline integration test.
/// It returns freshly classified [`Event`]s (each with a random UUID); it does
/// not quantize or arrange — those stay in the native crate's groove/arranger
/// layers.
///
/// Per-event duration is the gap to the next onset (or to end-of-audio for the
/// last onset); the feature window is that duration clamped to `[50, 500]` ms.
pub fn analyze_offline(audio: &AudioData, cfg: &OnsetConfig) -> Vec<Event> {
    let onsets = detect_onsets(audio, cfg);
    let classifier = HeuristicClassifier::new();
    let mut events = Vec::with_capacity(onsets.len());

    for (i, onset) in onsets.iter().enumerate() {
        let duration_ms = if i + 1 < onsets.len() {
            onsets[i + 1].timestamp_ms - onset.timestamp_ms
        } else {
            audio.duration_ms as f64 - onset.timestamp_ms
        };
        let window_duration_ms = duration_ms.clamp(50.0, 500.0);
        let features = extract_features_for_window(audio, onset.timestamp_ms, window_duration_ms);
        let result = classifier.classify(&features);
        events.push(
            Event::new(onset.timestamp_ms, duration_ms, result.class, result.confidence, features)
                .with_scores(result.class_scores()),
        );
    }

    events
}

/// RMS energy-threshold detector with a refractory window.
///
/// `push` is fed one render quantum (typically 128 samples) at a time and
/// returns `true` on the block where a transient crosses the threshold, then
/// stays silent for `refractory` samples afterwards. This is the streaming
/// surface the AudioWorklet drives; the offline pipeline above is the batch
/// counterpart.
pub struct SpikeDetector {
    #[allow(dead_code)]
    sample_rate: u32,
    refractory: u32,
    since_last: u32,
    threshold: f32,
}

impl SpikeDetector {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate,
            refractory: sample_rate / 10, // ~100ms
            since_last: u32::MAX,
            threshold: 0.08,
        }
    }

    pub fn push(&mut self, samples: &[f32]) -> bool {
        if samples.is_empty() {
            return false;
        }
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        self.since_last = self.since_last.saturating_add(samples.len() as u32);
        if rms > self.threshold && self.since_last > self.refractory {
            self.since_last = 0;
            return true;
        }
        false
    }
}

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmDetector(SpikeDetector);

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmDetector {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: u32) -> Self {
        Self(SpikeDetector::new(sample_rate))
    }

    pub fn push(&mut self, samples: &[f32]) -> bool {
        self.0.push(samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_never_fires() {
        let mut det = SpikeDetector::new(48_000);
        for _ in 0..100 {
            assert!(!det.push(&[0.0f32; 128]));
        }
    }

    #[test]
    fn loud_block_fires_once_then_refractory() {
        let mut det = SpikeDetector::new(48_000);
        // refractory = 4800 samples ≈ 37.5 blocks of 128.
        let loud = [0.5f32; 128];
        // First loud block after startup (since_last starts at u32::MAX) fires.
        assert!(det.push(&loud));
        // Immediately after, we are inside the refractory window.
        assert!(!det.push(&loud));
        // Feed enough blocks to clear the refractory window (>4800 samples).
        let mut fired_again = false;
        for _ in 0..40 {
            if det.push(&loud) {
                fired_again = true;
                break;
            }
        }
        assert!(fired_again, "should fire again after refractory clears");
    }

    #[test]
    fn empty_block_is_safe() {
        let mut det = SpikeDetector::new(48_000);
        assert!(!det.push(&[]));
    }
}
