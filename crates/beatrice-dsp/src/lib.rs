//! beatrice-dsp — Phase 3 SPIKE crate.
//!
//! This is a *stub* detector only. It exists to prove one thing: that a Rust
//! DSP crate can be compiled to WASM (wasm-pack `web` target), loaded inside an
//! AudioWorklet, and driven from the audio render thread with acceptable
//! latency. The real streaming onset/classification port lands in Task 2.
//!
//! Detector semantics (stub): RMS-over-threshold with a ~100ms refractory
//! window, matching the shape the real detector will expose so the worklet and
//! latency harness written against this API survive the Task 2 swap.

/// RMS energy-threshold detector with a refractory window.
///
/// `push` is fed one render quantum (typically 128 samples) at a time and
/// returns `true` on the block where a transient crosses the threshold, then
/// stays silent for `refractory` samples afterwards.
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
