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
            histogram_bins: 80, // Fewer, broader bins for small samples
            min_onsets: 4,      // 4 onsets is enough for a basic guess
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

    // Step 3: Find peaks in histogram
    let peaks = find_histogram_peaks(&histogram, config);

    // Step 4: Select best peak
    let (best_interval_ms, confidence) = select_best_tempo(&peaks, &histogram, config);

    // Step 5: Convert interval to BPM
    let bpm = if best_interval_ms > 0.0 {
        60000.0 / best_interval_ms
    } else {
        120.0
    };

    // Step 6: Generate beat grid from estimated tempo
    let beat_positions_ms = generate_beat_grid(onsets, bpm, best_interval_ms);

    TempoEstimate {
        bpm: bpm.max(config.min_bpm).min(config.max_bpm),
        confidence,
        beat_positions_ms,
    }
}

/// Compute inter-onset intervals (time between all pairs of onsets)
/// Using all-to-all pairs helps find periodic structure in short samples
fn compute_iois(onsets: &[Onset]) -> Vec<f64> {
    let mut iois = Vec::new();
    for i in 0..onsets.len() {
        for j in i + 1..onsets.len() {
            let interval = onsets[j].timestamp_ms - onsets[i].timestamp_ms;
            // Only consider intervals in a musical beat range (approx 60-200 BPM)
            if interval > 250.0 && interval < 1500.0 {
                iois.push(interval);
            }
        }
    }
    iois
}

/// Build histogram of inter-onset intervals with Gaussian spreading
fn build_ioi_histogram(iois: &[f64], config: &TempoConfig) -> Vec<f32> {
    let min_interval_ms = 60000.0 / config.max_bpm;
    let max_interval_ms = 60000.0 / config.min_bpm;
    let bin_width = (max_interval_ms - min_interval_ms) / config.histogram_bins as f64;
    
    let mut histogram = vec![0.0f32; config.histogram_bins];

    for &ioi in iois {
        // Spread each IOI across neighboring bins to ensure peak detection works
        for offset in -1..=1 {
            let spread_ioi = ioi + (offset as f64 * bin_width * 0.5);
            if spread_ioi >= min_interval_ms && spread_ioi <= max_interval_ms {
                let bin = ((spread_ioi - min_interval_ms) / bin_width) as usize;
                let bin = bin.min(config.histogram_bins - 1);
                let weight = if offset == 0 { 1.0 } else { 0.5 };
                histogram[bin] += weight;
            }
        }
    }

    histogram
}

/// Find peaks in the histogram using local maxima detection
fn find_histogram_peaks(histogram: &[f32], _config: &TempoConfig) -> Vec<(usize, f32)> {
    let mut peaks = Vec::new();

    // Find local maxima
    for i in 1..histogram.len() - 1 {
        if histogram[i] > histogram[i - 1] && histogram[i] > histogram[i + 1] && histogram[i] > 0.1 {
            peaks.push((i, histogram[i]));
        }
    }

    // Sort peaks by strength (descending)
    peaks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    peaks.truncate(5);
    peaks
}

/// Select the best tempo from peaks
fn select_best_tempo(
    peaks: &[(usize, f32)],
    histogram: &[f32],
    config: &TempoConfig,
) -> (f64, f32) {
    if peaks.is_empty() {
        return (500.0, 0.0); // Fallback: 120 BPM
    }

    let (best_bin, peak_strength) = peaks[0];
    let min_interval_ms = 60000.0 / config.max_bpm;
    let max_interval_ms = 60000.0 / config.min_bpm;
    let bin_width = (max_interval_ms - min_interval_ms) / config.histogram_bins as f64;

    let interval_ms = min_interval_ms + (best_bin as f64 * bin_width);

    // Calculate confidence based on peak strength relative to mean
    let sum: f32 = histogram.iter().sum();
    let mean = sum / histogram.len() as f32;
    let confidence = if mean > 0.0 {
        (peak_strength / (mean * 4.0)).min(1.0)
    } else {
        0.0
    };

    (interval_ms, confidence)
}

/// Generate beat grid positions based on estimated tempo
fn generate_beat_grid(onsets: &[Onset], _bpm: f64, interval_ms: f64) -> Vec<f64> {
    if onsets.is_empty() || interval_ms <= 0.0 {
        return Vec::new();
    }

    let first_onset = onsets[0].timestamp_ms;
    let last_onset = onsets[onsets.len() - 1].timestamp_ms;

    // Find best phase (offset)
    let num_phase_tests = 8;
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

    let mut beat_positions = Vec::new();
    let mut beat_time = best_phase;

    // Extend back to start of audio
    while beat_time > 0.0 {
        beat_time -= interval_ms;
    }
    beat_time += interval_ms;

    // Generate forward
    while beat_time <= last_onset + interval_ms {
        beat_positions.push(beat_time);
        beat_time += interval_ms;
    }

    beat_positions
}

/// Score how well a beat grid aligns with detected onsets
fn score_beat_alignment(onsets: &[Onset], phase: f64, interval_ms: f64, end_time: f64) -> f64 {
    if interval_ms <= 0.0 {
        return 0.0;
    }

    let tolerance_ms = interval_ms * 0.15;
    let mut score = 0.0;

    let mut beat_time = phase;
    while beat_time <= end_time {
        let closest_distance = onsets
            .iter()
            .map(|onset| (onset.timestamp_ms - beat_time).abs())
            .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or(f64::MAX);

        if closest_distance < tolerance_ms {
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
    fn test_tempo_estimation_regular_beats() {
        let mut onsets = Vec::new();
        // 110 BPM approx 545.45ms
        let interval = 60000.0 / 110.0;
        for i in 0..12 {
            onsets.push(Onset {
                timestamp_ms: i as f64 * interval,
                strength: 1.0,
            });
        }

        let estimate = estimate_tempo(&onsets, 44100);
        assert!(estimate.bpm > 108.0 && estimate.bpm < 112.0);
        assert!(estimate.confidence > 0.2);
    }
}
