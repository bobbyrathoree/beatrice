// Spectral feature extraction and onset detection
// Implements Spectral Flux (Superflux algorithm) for onset detection
// and extracts features for event classification

use realfft::{RealFftPlanner, RealToComplex};
use std::sync::Arc;

use crate::audio::AudioData;
use crate::events::types::EventFeatures;

/// Onset detection result
#[derive(Debug, Clone)]
pub struct Onset {
    /// Timestamp in milliseconds from start of audio
    pub timestamp_ms: f64,

    /// Onset strength/confidence [0.0, 1.0+]
    /// Higher values indicate stronger spectral changes
    pub strength: f32,
}

/// Configuration for onset detection
#[derive(Debug, Clone)]
pub struct OnsetConfig {
    /// FFT window size in samples (power of 2)
    pub window_size: usize,

    /// Hop size in samples (advance between frames)
    pub hop_size: usize,

    /// Threshold multiplier for adaptive peak picking
    /// Threshold = mean(flux) + threshold_factor * std(flux)
    pub threshold_factor: f32,

    /// Minimum time between onsets in milliseconds
    /// Prevents duplicate detections
    pub min_onset_gap_ms: f64,
}

impl Default for OnsetConfig {
    fn default() -> Self {
        OnsetConfig {
            window_size: 2048,
            hop_size: 512,
            threshold_factor: 1.5,
            min_onset_gap_ms: 30.0,
        }
    }
}

/// Extract spectral features from an audio segment
/// Used for event classification
pub fn extract_features(
    samples: &[f32],
    sample_rate: u32,
) -> EventFeatures {
    if samples.is_empty() {
        return EventFeatures::zero();
    }

    // Calculate Zero-Crossing Rate
    let zcr = calculate_zcr(samples);

    // Calculate spectral features using FFT
    let window_size = samples.len().min(2048);
    let (centroid, band_energies) = calculate_spectral_features(samples, sample_rate, window_size);

    EventFeatures {
        spectral_centroid: centroid,
        zcr,
        low_band_energy: band_energies[0],
        mid_band_energy: band_energies[1],
        high_band_energy: band_energies[2],
    }
}

/// Calculate Zero-Crossing Rate (ZCR)
/// Returns the rate of sign changes in the signal
/// Higher ZCR indicates noisy/unvoiced content
fn calculate_zcr(samples: &[f32]) -> f32 {
    if samples.len() < 2 {
        return 0.0;
    }

    let mut crossings = 0;
    for i in 1..samples.len() {
        if (samples[i] >= 0.0) != (samples[i - 1] >= 0.0) {
            crossings += 1;
        }
    }

    // Guard against division by zero (checked above, but defensive)
    let denominator = samples.len().saturating_sub(1);
    if denominator == 0 {
        return 0.0;
    }

    crossings as f32 / denominator as f32
}

/// Calculate spectral centroid and band energies
/// Returns (centroid in Hz, [low, mid, high] energy ratios)
fn calculate_spectral_features(
    samples: &[f32],
    sample_rate: u32,
    window_size: usize,
) -> (f32, [f32; 3]) {
    // Pad or truncate to window size
    let mut windowed = vec![0.0; window_size];
    let copy_len = samples.len().min(window_size);
    windowed[..copy_len].copy_from_slice(&samples[..copy_len]);

    // Apply Hann window to reduce spectral leakage
    apply_hann_window(&mut windowed);

    // Compute FFT
    let spectrum = compute_fft(&windowed);

    // Calculate spectral centroid
    let centroid = calculate_spectral_centroid(&spectrum, sample_rate, window_size);

    // Calculate band energies
    let band_energies = calculate_band_energies(&spectrum, sample_rate, window_size);

    (centroid, band_energies)
}

/// Apply Hann window function to reduce spectral leakage
fn apply_hann_window(samples: &mut [f32]) {
    let n = samples.len();

    // Guard against empty or single-sample arrays
    if n == 0 {
        return;
    }

    for i in 0..n {
        let window_val = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos());
        samples[i] *= window_val;
    }
}

/// Compute real FFT and return magnitude spectrum
fn compute_fft(samples: &[f32]) -> Vec<f32> {
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(samples.len());

    let mut input = samples.to_vec();
    let mut spectrum = fft.make_output_vec();

    fft.process(&mut input, &mut spectrum).unwrap();

    // Convert complex spectrum to magnitudes
    spectrum.iter().map(|c| c.norm()).collect()
}

/// Calculate spectral centroid (center of mass of spectrum)
/// Returns frequency in Hz
fn calculate_spectral_centroid(spectrum: &[f32], sample_rate: u32, window_size: usize) -> f32 {
    // Guard against zero window size
    if window_size == 0 {
        return 0.0;
    }

    let mut weighted_sum = 0.0;
    let mut total_magnitude = 0.0;

    let bin_width = sample_rate as f32 / window_size as f32;

    for (i, &magnitude) in spectrum.iter().enumerate() {
        let frequency = i as f32 * bin_width;
        weighted_sum += frequency * magnitude;
        total_magnitude += magnitude;
    }

    if total_magnitude > 0.0 {
        weighted_sum / total_magnitude
    } else {
        0.0
    }
}

/// Calculate energy in frequency bands: low (0-200 Hz), mid (200-2000 Hz), high (2000+ Hz)
/// Returns normalized energy ratios [low, mid, high]
fn calculate_band_energies(spectrum: &[f32], sample_rate: u32, window_size: usize) -> [f32; 3] {
    // Guard against zero window size
    if window_size == 0 {
        return [0.0, 0.0, 0.0];
    }

    let bin_width = sample_rate as f32 / window_size as f32;

    // Guard against zero bin width (should not happen with guard above, but defensive)
    if bin_width <= 0.0 {
        return [0.0, 0.0, 0.0];
    }

    // Define band boundaries
    let low_max_hz = 200.0;
    let mid_max_hz = 2000.0;

    let low_max_bin = (low_max_hz / bin_width) as usize;
    let mid_max_bin = (mid_max_hz / bin_width) as usize;

    let mut low_energy = 0.0;
    let mut mid_energy = 0.0;
    let mut high_energy = 0.0;

    for (i, &magnitude) in spectrum.iter().enumerate() {
        let energy = magnitude * magnitude;
        if i < low_max_bin {
            low_energy += energy;
        } else if i < mid_max_bin {
            mid_energy += energy;
        } else {
            high_energy += energy;
        }
    }

    let total_energy = low_energy + mid_energy + high_energy;

    if total_energy > 0.0 {
        [
            low_energy / total_energy,
            mid_energy / total_energy,
            high_energy / total_energy,
        ]
    } else {
        [0.0, 0.0, 0.0]
    }
}

/// Detect onsets using Spectral Flux (Superflux algorithm)
/// Returns list of onset timestamps and strengths
pub fn detect_onsets(audio: &AudioData, config: &OnsetConfig) -> Vec<Onset> {
    // Convert to mono for onset detection
    let mono = audio.to_mono();

    if mono.is_empty() {
        return Vec::new();
    }

    // Compute spectral flux across all frames
    let flux = compute_spectral_flux(&mono, audio.sample_rate, config);

    if flux.is_empty() {
        return Vec::new();
    }

    // Apply adaptive threshold to pick onset peaks
    let onsets = pick_onset_peaks(&flux, audio.sample_rate, config);

    onsets
}

/// Compute spectral flux for all frames
/// Spectral flux = sum of positive differences between consecutive magnitude spectra
fn compute_spectral_flux(
    samples: &[f32],
    sample_rate: u32,
    config: &OnsetConfig,
) -> Vec<f32> {
    let window_size = config.window_size;
    let hop_size = config.hop_size;

    // Guard against zero hop size
    if hop_size == 0 {
        return Vec::new();
    }

    let num_frames = (samples.len().saturating_sub(window_size)) / hop_size + 1;

    if num_frames == 0 {
        return Vec::new();
    }

    let mut flux = Vec::with_capacity(num_frames);
    let mut prev_spectrum: Option<Vec<f32>> = None;

    for frame_idx in 0..num_frames {
        let start = frame_idx * hop_size;
        let end = (start + window_size).min(samples.len());

        if end - start < window_size {
            break;
        }

        let frame = &samples[start..end];

        // Window and compute FFT
        let mut windowed = frame.to_vec();
        apply_hann_window(&mut windowed);
        let spectrum = compute_fft(&windowed);

        // Calculate flux as sum of positive differences
        let frame_flux = if let Some(ref prev) = prev_spectrum {
            let mut sum = 0.0;
            for (curr, prev) in spectrum.iter().zip(prev.iter()) {
                let diff = curr - prev;
                if diff > 0.0 {
                    sum += diff;
                }
            }
            sum
        } else {
            0.0 // First frame has no flux
        };

        flux.push(frame_flux);
        prev_spectrum = Some(spectrum);
    }

    flux
}

/// Pick onset peaks from spectral flux using adaptive threshold
fn pick_onset_peaks(
    flux: &[f32],
    sample_rate: u32,
    config: &OnsetConfig,
) -> Vec<Onset> {
    if flux.len() < 2 {
        return Vec::new();
    }

    // Calculate adaptive threshold
    // Guard against empty flux (checked above, but defensive)
    if flux.is_empty() {
        return Vec::new();
    }

    let mean = flux.iter().sum::<f32>() / flux.len() as f32;
    let variance = flux.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / flux.len() as f32;
    let std_dev = variance.sqrt();
    let threshold = mean + config.threshold_factor * std_dev;

    let mut onsets = Vec::new();
    let hop_size = config.hop_size;

    // Guard against zero hop size
    if hop_size == 0 {
        return Vec::new();
    }

    let min_gap_samples = (config.min_onset_gap_ms * sample_rate as f64 / 1000.0) as usize;
    let min_gap_frames = min_gap_samples / hop_size;

    let mut last_onset_frame = 0;

    // Find local maxima above threshold
    for i in 1..flux.len() - 1 {
        let is_peak = flux[i] > flux[i - 1] && flux[i] > flux[i + 1];
        let above_threshold = flux[i] > threshold;
        let gap_ok = (i - last_onset_frame) >= min_gap_frames;

        if is_peak && above_threshold && gap_ok {
            // Guard against zero sample rate (should not happen, but defensive)
            let timestamp_ms = if sample_rate > 0 {
                (i * hop_size) as f64 * 1000.0 / sample_rate as f64
            } else {
                0.0
            };
            let strength = (flux[i] - threshold) / (std_dev + 1e-6); // Normalize strength (1e-6 protects from division by zero)

            onsets.push(Onset {
                timestamp_ms,
                strength: strength.min(1.0).max(0.0),
            });

            last_onset_frame = i;
        }
    }

    onsets
}

/// Extract features for a specific time window
/// Used to analyze audio around a detected onset
pub fn extract_features_for_window(
    audio: &AudioData,
    start_ms: f64,
    duration_ms: f64,
) -> EventFeatures {
    let start_sample = ((start_ms / 1000.0) * audio.sample_rate as f64) as usize;
    let duration_samples = ((duration_ms / 1000.0) * audio.sample_rate as f64) as usize;

    let mono = audio.to_mono();
    let end_sample = (start_sample + duration_samples).min(mono.len());

    if start_sample >= mono.len() || start_sample >= end_sample {
        return EventFeatures::zero();
    }

    let window = &mono[start_sample..end_sample];
    extract_features(window, audio.sample_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zcr_calculation() {
        // Alternating signal should have high ZCR
        let alternating = vec![1.0, -1.0, 1.0, -1.0, 1.0, -1.0];
        let zcr = calculate_zcr(&alternating);
        assert!(zcr > 0.8); // Should be close to 1.0

        // Constant signal should have zero ZCR
        let constant = vec![1.0, 1.0, 1.0, 1.0];
        let zcr = calculate_zcr(&constant);
        assert_eq!(zcr, 0.0);
    }

    #[test]
    fn test_hann_window() {
        let mut samples = vec![1.0; 100];
        apply_hann_window(&mut samples);

        // Window should taper at edges
        assert!(samples[0] < 0.1);
        assert!(samples[99] < 0.1);
        assert!(samples[50] > 0.9); // Peak in middle
    }

    #[test]
    fn test_feature_extraction_empty() {
        let features = extract_features(&[], 44100);
        assert_eq!(features.zcr, 0.0);
        assert_eq!(features.spectral_centroid, 0.0);
    }

    #[test]
    fn test_onset_detection_empty() {
        let audio = AudioData {
            samples: vec![],
            sample_rate: 44100,
            channels: 1,
            bit_depth: 16,
            duration_ms: 0,
            frame_count: 0,
        };

        let config = OnsetConfig::default();
        let onsets = detect_onsets(&audio, &config);
        assert!(onsets.is_empty());
    }
}
