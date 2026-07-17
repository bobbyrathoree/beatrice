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
    gaussian_features, CalibrationProfile, CalibrationSample, ClassScore, ClassificationResult,
    ClassifierConfig, Event, EventClass, EventFeatures, GaussianModel, HeuristicClassifier,
    HybridClassifier, KnnClassifier, DEFAULT_MAP_TAU, GAUSSIAN_DIMS,
};
pub use features::{
    detect_onsets, extract_features, extract_features_for_window, extract_mfcc,
    extract_mfcc_for_window, extract_mfcc_stats, Onset, OnsetConfig, MFCC_COEFFS,
};
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

/// Run the offline analysis pipeline with the [`HybridClassifier`] (the
/// AVP-fitted Gaussian MFCC model + heuristic hum gate) — the app's shipping
/// classification path since the AVP benchmark showed it at 81.6%
/// participant-wise vs 65.8% for the pure heuristic.
///
/// Same onset/duration logic as [`analyze_offline`], but the classifier's
/// scalar features AND MFCCs are both extracted over a fixed
/// [`events::hybrid::HYBRID_MFCC_WINDOW_MS`] window — the window the factory
/// model was fitted with and the streaming path uses. (The heuristic
/// [`analyze_offline`] keeps the variable gap-to-next-onset feature window; its
/// golden freeze tests pin the extraction refactor, so it must not change.)
/// `Event.duration_ms` still reports the musical gap to the next onset.
pub fn analyze_offline_hybrid(
    audio: &AudioData,
    cfg: &OnsetConfig,
    classifier: &HybridClassifier,
) -> Vec<Event> {
    let onsets = detect_onsets(audio, cfg);
    let mono = audio.to_mono();
    let mut events = Vec::with_capacity(onsets.len());

    for (i, onset) in onsets.iter().enumerate() {
        let duration_ms = if i + 1 < onsets.len() {
            onsets[i + 1].timestamp_ms - onset.timestamp_ms
        } else {
            audio.duration_ms as f64 - onset.timestamp_ms
        };
        // Scalar features over the SAME fixed window the factory model was
        // fitted with (and the streaming path uses). The Gaussian's zcr/crest
        // dims and the hum gate are calibrated to 150ms statistics; a variable
        // gap-to-next-onset window (up to 500ms of decay/silence) skews both.
        let features = extract_features_for_window(
            audio,
            onset.timestamp_ms,
            events::hybrid::HYBRID_MFCC_WINDOW_MS,
        );

        let start = ((onset.timestamp_ms / 1000.0) * audio.sample_rate as f64) as usize;
        let mfcc_len = ((events::hybrid::HYBRID_MFCC_WINDOW_MS / 1000.0)
            * audio.sample_rate as f64) as usize;
        let end = (start + mfcc_len).min(mono.len());
        let mfcc = if start < end {
            extract_mfcc(&mono[start..end], audio.sample_rate)
        } else {
            vec![0.0; MFCC_COEFFS]
        };

        let result = classifier.classify(&features, &mfcc);
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

/// Number of `f32`s per event record in the [`WasmDetector::push`] ABI:
/// `[t_ms, class_id, confidence, centroid, zcr, low, mid, high, peak, crest,
/// mfcc1..mfcc20]`. Floats 3..10 are the [`EventFeatures`] and 10..30 the mean
/// MFCCs of the classification window, forwarded so the main thread can send a
/// detected event back as a labeled calibration sample without re-deriving
/// features. The worklet decodes in strides of this size, so it is part of the
/// ABI contract — bump it in lockstep on both sides
/// (`src/worklet/detector.worklet.ts` EVENT_STRIDE).
#[cfg(feature = "wasm")]
pub const WASM_EVENT_STRIDE: usize = 10 + crate::features::MFCC_COEFFS;

/// WASM surface over the causal [`StreamingDetector`], driven by the
/// AudioWorklet one render quantum at a time.
///
/// # ABI (JSON-free, no serde in the hot path)
///
/// [`push`](Self::push) returns a flat `Float32Array` of [`WASM_EVENT_STRIDE`]
/// (30) floats per event: `[t_ms, class_id, confidence, centroid, zcr,
/// low_band, mid_band, high_band, peak, crest, mfcc1..mfcc20]`. An empty array
/// means "no event this quantum" (the common case). The length is always a
/// multiple of the stride. `class_id` is [`class_id`]'s mapping; floats 3..10
/// are the event's [`EventFeatures`] in struct-declaration order and floats
/// 10..30 the classification window's mean MFCCs. The worklet reads the
/// records and posts one `{ type: "event", tMs, classId, conf, features }`
/// message per event (features = all 27 trailing floats). The features let the
/// calibration panel echo a detected event back via
/// [`add_calibration_sample`](Self::add_calibration_sample) as a labeled sample.
///
/// # Calibration (Task 5, few-shot personalization)
///
/// [`add_calibration_sample`](Self::add_calibration_sample) feeds a labeled
/// example into the live profile; [`set_calibration_enabled`](Self::set_calibration_enabled)
/// flips the FACTORY/YOURS A/B toggle. Both are cheap main→worklet messages.
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

    /// Push one render quantum. Returns [`WASM_EVENT_STRIDE`]-float records
    /// (flat) for every event confirmed during this quantum; empty if none.
    pub fn push(&mut self, samples: &[f32]) -> Vec<f32> {
        let events = self.0.push(samples);
        let mut out = Vec::with_capacity(events.len() * WASM_EVENT_STRIDE);
        for e in events {
            out.push(e.t_ms as f32);
            out.push(class_id(e.class));
            out.push(e.confidence);
            let f = &e.features;
            out.push(f.spectral_centroid);
            out.push(f.zcr);
            out.push(f.low_band_energy);
            out.push(f.mid_band_energy);
            out.push(f.high_band_energy);
            out.push(f.peak_amplitude);
            out.push(f.crest_factor);
            for i in 0..crate::features::MFCC_COEFFS {
                out.push(e.mfcc.get(i).copied().unwrap_or(0.0));
            }
        }
        out
    }

    /// Add a labeled calibration sample from the main thread. `class_id` is the
    /// [`class_id`] mapping (0=kick, 1=hihat, 2=snare/click, 3=hum); `features`
    /// is the 27-float `[EventFeatures 7, mfcc 20]` vector (same order as the
    /// trailing floats in [`push`](Self::push)). A legacy 7-float slice still
    /// works (MFCCs default to zero); shorter/garbled slices are ignored so a
    /// malformed message can never poison the profile.
    pub fn add_calibration_sample(&mut self, class_id: u32, features: &[f32]) {
        if features.len() < 7 {
            return;
        }
        let class = class_from_id(class_id);
        let feats = EventFeatures {
            spectral_centroid: features[0],
            zcr: features[1],
            low_band_energy: features[2],
            mid_band_energy: features[3],
            high_band_energy: features[4],
            peak_amplitude: features[5],
            crest_factor: features[6],
        };
        let mfcc: Vec<f32> = features
            .get(7..7 + crate::features::MFCC_COEFFS)
            .map(|s| s.to_vec())
            .unwrap_or_default();
        // raw_window empty: the live path stores features only (the offline
        // pipeline re-derives features from audio; live samples never train ML).
        self.0.add_calibration_sample(CalibrationSample::with_mfcc(
            class,
            feats,
            mfcc,
            Vec::new(),
            self.0.sample_rate(),
        ));
    }

    /// Flip the FACTORY/YOURS A/B toggle. `true` = personal (MAP-adapted once
    /// the profile is sufficient); `false` = factory model.
    pub fn set_calibration_enabled(&mut self, enabled: bool) {
        self.0.set_calibration_enabled(enabled);
    }

    /// Drop the live calibration profile (kNN reverts to `None`, so
    /// classification falls back to the heuristic). Sent when a re-teach begins
    /// so new samples do not APPEND onto a profile the worklet was re-seeded with
    /// on jam start — otherwise the live profile would drift from what the panel
    /// accumulates and persists to localStorage.
    pub fn clear_calibration(&mut self) {
        self.0.clear_calibration();
    }

    /// Whether the accumulated profile has ≥5 samples for all 4 classes.
    pub fn is_calibration_sufficient(&self) -> bool {
        self.0.is_calibration_sufficient()
    }

    /// The live calibration profile serialized to JSON bytes, for persistence
    /// (localStorage in the browser, `create_calibration_profile` on native).
    pub fn calibration_profile_json(&self) -> Vec<u8> {
        self.0
            .calibration_profile()
            .to_json_bytes()
            .unwrap_or_default()
    }
}

/// Map the ABI `class_id` back to an [`EventClass`]. Inverse of [`class_id`];
/// out-of-range ids fall back to `Click` (the neutral mid class), matching the
/// frontend's defensive default.
#[cfg(feature = "wasm")]
fn class_from_id(id: u32) -> EventClass {
    match id {
        0 => EventClass::BilabialPlosive,
        1 => EventClass::HihatNoise,
        2 => EventClass::Click,
        3 => EventClass::HumVoiced,
        _ => EventClass::Click,
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

#[cfg(test)]
mod offline_hybrid_tests {
    use super::*;

    /// 150→60Hz sweep kick with sharp decay (same as streaming.rs tests).
    fn synth_kick(sample_rate: u32, dur_sec: f32) -> Vec<f32> {
        let n = (sample_rate as f32 * dur_sec) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                let freq = if t < 0.05 { 150.0 - 90.0 * t / 0.05 } else { 60.0 };
                let phase = 2.0 * std::f32::consts::PI * freq * t;
                phase.sin() * (-35.0 * t).exp() * 0.9
            })
            .collect()
    }

    /// The classifier's scalar features must come from the SAME fixed 150ms
    /// window the factory model was fitted with (and streaming uses) — not
    /// the variable gap-to-next-onset window. A lone kick followed by 850ms
    /// of silence makes the two windows maximally different (150 vs 500ms).
    #[test]
    fn hybrid_offline_scalar_window_is_fixed_150ms() {
        let sr = 44_100u32;
        let mut samples = synth_kick(sr, 0.15);
        samples.resize(sr as usize, 0.0); // 1s total: kick + long silence
        let frame_count = samples.len();
        let audio = AudioData {
            samples,
            sample_rate: sr,
            channels: 1,
            bit_depth: 16,
            duration_ms: 1000,
            frame_count,
        };
        let events =
            analyze_offline_hybrid(&audio, &OnsetConfig::default(), &HybridClassifier::factory());
        assert_eq!(events.len(), 1, "expected exactly one onset");
        let expected = extract_features_for_window(
            &audio,
            events[0].timestamp_ms,
            events::hybrid::HYBRID_MFCC_WINDOW_MS,
        );
        assert_eq!(
            events[0].features.crest_factor, expected.crest_factor,
            "crest must be computed over the fixed 150ms window"
        );
        assert_eq!(events[0].features.zcr, expected.zcr);
        // duration_ms still reports the musical gap, not the feature window
        assert!(events[0].duration_ms > 500.0);
    }
}
