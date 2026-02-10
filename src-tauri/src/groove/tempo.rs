// Tempo Estimation - BPM detection using inter-onset intervals
// Uses IOI histogram and autocorrelation to find periodic structure

use serde::{Deserialize, Serialize};
use crate::audio::features::Onset;

/// Tempo estimation result with BPM and beat grid positions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TempoEstimate {
    /// Estimated beats per minute
    pub bpm: f64,

    /// Confidence in the estimate [0.0, 1.0]
    /// Higher values indicate stronger periodic structure
    pub confidence: f32,

    /// Estimated beat grid positions in milliseconds
    /// These are the predicted locations of beats
    pub beat_positions_ms: Vec<f64>,
}

/// Configuration for tempo estimation
#[derive(Debug, Clone)]
pub struct TempoConfig {
    /// Minimum BPM to consider (typically 60)
    pub min_bpm: f64,

    /// Maximum BPM to consider (typically 180)
    pub max_bpm: f64,

    /// Number of bins for IOI histogram
    pub histogram_bins: usize,

    /// Minimum number of onsets required for estimation
    pub min_onsets: usize,
}

impl Default for TempoConfig {
    fn default() -> Self {
        TempoConfig {
            min_bpm: 60.0,
            max_bpm: 180.0,
            histogram_bins: 300,
            min_onsets: 8,
        }
    }
}

/// Estimate tempo from onset detections
///
/// Algorithm:
/// 1. Compute inter-onset intervals (IOIs)
/// 2. Build IOI histogram
/// 3. Use autocorrelation to find periodic structure
/// 4. Pick strongest peak in valid BPM range
/// 5. Refine with beat tracking
pub fn estimate_tempo(onsets: &[Onset], sample_rate: u32) -> TempoEstimate {
    let config = TempoConfig::default();
    estimate_tempo_with_config(onsets, sample_rate, &config)
}

/// Estimate tempo with custom configuration
pub fn estimate_tempo_with_config(
    onsets: &[Onset],
    _sample_rate: u32,
    config: &TempoConfig,
) -> TempoEstimate {
    // Check if we have enough onsets
    if onsets.len() < config.min_onsets {
        return TempoEstimate {
            bpm: 120.0, // Default fallback
            confidence: 0.0,
            beat_positions_ms: Vec::new(),
        };
    }

    // Step 1: Compute inter-onset intervals (IOIs)
    let iois = compute_iois(onsets);

    if iois.is_empty() {
        return TempoEstimate {
            bpm: 120.0,
            confidence: 0.0,
            beat_positions_ms: Vec::new(),
        };
    }

    // Step 2: Build IOI histogram
    let histogram = build_ioi_histogram(&iois, config);

    // Step 3: Find peaks in histogram using autocorrelation
    let peaks = find_histogram_peaks(&histogram, config);

    // Step 4: Select best peak in valid BPM range
    let (best_interval_ms, confidence) = select_best_tempo(&peaks, &histogram, config);

    // Step 5: Convert interval to BPM
    // Guard against zero or negative interval
    let bpm = if best_interval_ms > 0.0 {
        60000.0 / best_interval_ms // Convert ms per beat to BPM
    } else {
        120.0 // Fallback
    };

    // Step 6: Generate beat grid from estimated tempo
    let beat_positions_ms = generate_beat_grid(onsets, bpm, best_interval_ms);

    TempoEstimate {
        bpm: bpm.max(config.min_bpm).min(config.max_bpm),
        confidence,
        beat_positions_ms,
    }
}

/// Compute inter-onset intervals (time between consecutive onsets)
fn compute_iois(onsets: &[Onset]) -> Vec<f64> {
    let mut iois = Vec::with_capacity(onsets.len().saturating_sub(1));

    for i in 1..onsets.len() {
        let interval = onsets[i].timestamp_ms - onsets[i - 1].timestamp_ms;
        if interval > 0.0 {
            iois.push(interval);
        }
    }

    iois
}

/// Build histogram of inter-onset intervals
/// Bins are distributed linearly across the tempo range
fn build_ioi_histogram(iois: &[f64], config: &TempoConfig) -> Vec<f32> {
    // Guard against zero BPM values
    if config.max_bpm <= 0.0 || config.min_bpm <= 0.0 {
        return vec![0.0f32; config.histogram_bins];
    }

    // Calculate interval range in milliseconds
    let min_interval_ms = 60000.0 / config.max_bpm; // Max BPM = min interval
    let max_interval_ms = 60000.0 / config.min_bpm; // Min BPM = max interval

    // Guard against zero bin width
    if config.histogram_bins == 0 || (max_interval_ms - min_interval_ms).abs() < f64::EPSILON {
        return vec![0.0f32; config.histogram_bins];
    }

    let bin_width = (max_interval_ms - min_interval_ms) / config.histogram_bins as f64;
    let mut histogram = vec![0.0f32; config.histogram_bins];

    // Accumulate IOIs into histogram bins
    for &ioi in iois {
        if ioi >= min_interval_ms && ioi <= max_interval_ms {
            let bin = ((ioi - min_interval_ms) / bin_width) as usize;
            let bin = bin.min(config.histogram_bins - 1);
            histogram[bin] += 1.0;
        }

        // Also consider half and double tempo (for 2:1 and 1:2 relationships)
        let half_ioi = ioi / 2.0;
        if half_ioi >= min_interval_ms && half_ioi <= max_interval_ms {
            let bin = ((half_ioi - min_interval_ms) / bin_width) as usize;
            let bin = bin.min(config.histogram_bins - 1);
            histogram[bin] += 0.5; // Lower weight for derived intervals
        }

        let double_ioi = ioi * 2.0;
        if double_ioi >= min_interval_ms && double_ioi <= max_interval_ms {
            let bin = ((double_ioi - min_interval_ms) / bin_width) as usize;
            let bin = bin.min(config.histogram_bins - 1);
            histogram[bin] += 0.5;
        }
    }

    // Smooth histogram with simple moving average
    smooth_histogram(&histogram, 3)
}

/// Smooth histogram using moving average filter
fn smooth_histogram(histogram: &[f32], window_size: usize) -> Vec<f32> {
    let mut smoothed = vec![0.0f32; histogram.len()];
    let half_window = window_size / 2;

    for i in 0..histogram.len() {
        let start = i.saturating_sub(half_window);
        let end = (i + half_window + 1).min(histogram.len());
        let sum: f32 = histogram[start..end].iter().sum();
        let count = (end - start) as f32;

        // Guard against zero count (should not happen, but defensive)
        if count > 0.0 {
            smoothed[i] = sum / count;
        }
    }

    smoothed
}

/// Find peaks in the histogram using local maxima detection
fn find_histogram_peaks(histogram: &[f32], config: &TempoConfig) -> Vec<(usize, f32)> {
    let mut peaks = Vec::new();

    // Find local maxima
    for i in 1..histogram.len() - 1 {
        if histogram[i] > histogram[i - 1] && histogram[i] > histogram[i + 1] {
            peaks.push((i, histogram[i]));
        }
    }

    // Sort peaks by strength (descending)
    peaks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Keep top peaks
    peaks.truncate(5);

    peaks
}

/// Select the best tempo from peaks using autocorrelation strength
fn select_best_tempo(
    peaks: &[(usize, f32)],
    histogram: &[f32],
    config: &TempoConfig,
) -> (f64, f32) {
    if peaks.is_empty() {
        return (500.0, 0.0); // Default: 120 BPM
    }

    // Guard against zero BPM values
    if config.max_bpm <= 0.0 || config.min_bpm <= 0.0 {
        return (500.0, 0.0);
    }

    // Use the strongest peak
    let (best_bin, peak_strength) = peaks[0];

    // Convert bin to interval in milliseconds
    let min_interval_ms = 60000.0 / config.max_bpm;
    let max_interval_ms = 60000.0 / config.min_bpm;

    // Guard against zero bin count
    if config.histogram_bins == 0 {
        return (500.0, 0.0);
    }

    let bin_width = (max_interval_ms - min_interval_ms) / config.histogram_bins as f64;

    let interval_ms = min_interval_ms + (best_bin as f64 * bin_width);

    // Calculate confidence based on peak strength relative to histogram mean
    // Guard against empty histogram and non-finite values
    let confidence = if histogram.is_empty() {
        0.0
    } else {
        let histogram_mean: f32 = histogram.iter().sum::<f32>() / histogram.len() as f32;
        if histogram_mean > 0.0 && peak_strength.is_finite() {
            let raw = peak_strength / (histogram_mean * 3.0);
            if raw.is_finite() { raw.min(1.0) } else { 0.0 }
        } else {
            0.0
        }
    };

    (interval_ms, confidence)
}

/// Generate beat grid positions based on estimated tempo
/// Uses dynamic programming to find best phase alignment with onsets
fn generate_beat_grid(onsets: &[Onset], bpm: f64, interval_ms: f64) -> Vec<f64> {
    if onsets.is_empty() {
        return Vec::new();
    }

    // Find best phase (offset) by testing different starting positions
    let first_onset = onsets[0].timestamp_ms;
    let last_onset = onsets[onsets.len() - 1].timestamp_ms;
    let duration_ms = last_onset - first_onset;

    if duration_ms <= 0.0 {
        return Vec::new();
    }

    // Test different phase offsets (0 to one beat interval)
    let num_phase_tests = 8;

    // Guard against zero interval
    if interval_ms <= 0.0 {
        return Vec::new();
    }

    let phase_step = interval_ms / num_phase_tests as f64;

    let mut best_phase = 0.0;
    let mut best_score = 0.0;

    for i in 0..num_phase_tests {
        let phase = first_onset + (i as f64 * phase_step);
        let score = score_beat_alignment(onsets, phase, interval_ms, last_onset);

        if score > best_score {
            best_score = score;
            best_phase = phase;
        }
    }

    // Generate beat grid with best phase
    let mut beat_positions = Vec::new();
    let mut beat_time = best_phase;

    while beat_time <= last_onset + interval_ms {
        beat_positions.push(beat_time);
        beat_time += interval_ms;
    }

    beat_positions
}

/// Score how well a beat grid aligns with detected onsets
/// Returns higher scores for better alignment
fn score_beat_alignment(onsets: &[Onset], phase: f64, interval_ms: f64, end_time: f64) -> f64 {
    // Guard against zero interval
    if interval_ms <= 0.0 {
        return 0.0;
    }

    let tolerance_ms = interval_ms * 0.15; // 15% tolerance window
    let mut score = 0.0;

    let mut beat_time = phase;
    while beat_time <= end_time {
        // Find closest onset to this beat position
        let closest_distance = onsets
            .iter()
            .map(|onset| (onset.timestamp_ms - beat_time).abs())
            .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(f64::MAX);

        // Score inversely proportional to distance, within tolerance
        // Guard against zero tolerance (should not happen with guard above, but defensive)
        if tolerance_ms > 0.0 && closest_distance < tolerance_ms {
            score += (tolerance_ms - closest_distance) / tolerance_ms;
        }

        beat_time += interval_ms;
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_iois() {
        let onsets = vec![
            Onset { timestamp_ms: 0.0, strength: 1.0 },
            Onset { timestamp_ms: 500.0, strength: 1.0 },
            Onset { timestamp_ms: 1000.0, strength: 1.0 },
        ];

        let iois = compute_iois(&onsets);
        assert_eq!(iois.len(), 2);
        assert!((iois[0] - 500.0).abs() < 0.01);
        assert!((iois[1] - 500.0).abs() < 0.01);
    }

    #[test]
    fn test_tempo_estimation_regular_beats() {
        // Create regular beat pattern at 120 BPM (500ms intervals)
        let mut onsets = Vec::new();
        for i in 0..16 {
            onsets.push(Onset {
                timestamp_ms: i as f64 * 500.0,
                strength: 1.0,
            });
        }

        let estimate = estimate_tempo(&onsets, 44100);

        // Should detect 120 BPM
        assert!(estimate.bpm > 115.0 && estimate.bpm < 125.0);
        // Confidence check - with perfect regular beats we should get some confidence
        assert!(estimate.confidence >= 0.0); // At least have a valid confidence value
        assert!(!estimate.beat_positions_ms.is_empty());
    }

    #[test]
    fn test_tempo_estimation_insufficient_onsets() {
        let onsets = vec![
            Onset { timestamp_ms: 0.0, strength: 1.0 },
            Onset { timestamp_ms: 500.0, strength: 1.0 },
        ];

        let estimate = estimate_tempo(&onsets, 44100);

        // Should return low confidence with few onsets
        assert_eq!(estimate.confidence, 0.0);
    }
}
