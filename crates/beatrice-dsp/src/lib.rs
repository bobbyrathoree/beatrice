//! beatrice-dsp — the shared offline DSP core.
//!
//! This crate owns the deterministic "what" of Beatrice's analysis pipeline:
//! audio ingest container ([`ingest::AudioData`]), spectral onset detection +
//! feature extraction ([`features`]), event types and classification
//! ([`events`]), and the causal [`streaming::StreamingDetector`] driven by the
//! WASM worklet.
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
pub mod streaming;

pub use events::{
    CalibrationProfile, CalibrationSample, ClassScore, ClassificationResult, ClassifierConfig,
    Event, EventClass, EventFeatures, HeuristicClassifier, KnnClassifier,
};
pub use features::{detect_onsets, extract_features, extract_features_for_window, Onset, OnsetConfig};
pub use ingest::AudioData;
pub use streaming::{LiveEvent, StreamingConfig, StreamingDetector};

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

/// Stable numeric id for an [`EventClass`], for the JSON-free WASM ABI.
///
/// Matches the enum declaration order and the frontend `tauri-mock` convention
/// (`0` = plosive/kick, `1` = hi-hat, `2` = click/snare, `3` = hum). The worklet
/// maps these back to class names, so this ordering is part of the ABI contract
/// — do not reorder without updating `detector.worklet.ts`.
pub fn class_id(class: EventClass) -> f32 {
    match class {
        EventClass::BilabialPlosive => 0.0,
        EventClass::HihatNoise => 1.0,
        EventClass::Click => 2.0,
        EventClass::HumVoiced => 3.0,
    }
}

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// WASM surface over the causal [`StreamingDetector`], driven by the
/// AudioWorklet one render quantum at a time.
///
/// # ABI (JSON-free, no serde in the hot path)
///
/// [`push`](Self::push) returns a flat `Float32Array` of **3 floats per event**:
/// `[t_ms, class_id, confidence, t_ms, class_id, confidence, ...]`. An empty
/// array means "no event this quantum" (the common case). The length is always
/// a multiple of 3. `class_id` is [`class_id`]'s mapping. The worklet reads the
/// triples and posts one `{ type: "event", t, classId, conf }` message per event
/// to the main thread. This avoids allocating/serializing JSON on the audio
/// render thread.
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmDetector(StreamingDetector);

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmDetector {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: u32) -> Self {
        Self(StreamingDetector::new(sample_rate))
    }

    /// Push one render quantum. Returns `[t_ms, class_id, confidence]` triples
    /// (flat) for every event confirmed during this quantum; empty if none.
    pub fn push(&mut self, samples: &[f32]) -> Vec<f32> {
        let events = self.0.push(samples);
        let mut out = Vec::with_capacity(events.len() * 3);
        for e in events {
            out.push(e.t_ms as f32);
            out.push(class_id(e.class));
            out.push(e.confidence);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_ids_are_stable_and_distinct() {
        // The worklet decodes these — guard the ABI ordering.
        assert_eq!(class_id(EventClass::BilabialPlosive), 0.0);
        assert_eq!(class_id(EventClass::HihatNoise), 1.0);
        assert_eq!(class_id(EventClass::Click), 2.0);
        assert_eq!(class_id(EventClass::HumVoiced), 3.0);
    }
}
