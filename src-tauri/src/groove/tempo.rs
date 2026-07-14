// Tempo Estimation - BPM detection using inter-onset intervals
// Uses IOI histogram and autocorrelation to find periodic structure

use serde::{Deserialize, Serialize};
use crate::audio::features::Onset;

/// Tempo estimation result with BPM and beat grid positions
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TempoEstimate {
    /// Estimated beats per minute
    pub bpm: f64,

    /// Confidence in the estimate [0.0, 1.0]
    /// Higher values indicate stronger periodic structure
    pub confidence: f32,

    /// Estimated beat grid positions in milliseconds
    /// These are the predicted locations of beats
    pub beat_positions_ms: Vec<f64>,

    /// Position of the first beat in milliseconds (the grid's phase offset).
    /// Derived from the head of `beat_positions_ms`; lets consumers align an
    /// arrangement to where the performer actually started playing.
    pub phase_offset_ms: f64,
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
            phase_offset_ms: 0.0,
        };
    }

    // Step 1: Compute inter-onset intervals (IOIs)
    let iois = compute_iois(onsets);

    if iois.is_empty() {
        return TempoEstimate {
            bpm: 120.0,
            confidence: 0.0,
            beat_positions_ms: Vec::new(),
            phase_offset_ms: 0.0,
        };
    }

    // Step 2: Build IOI histogram
    let histogram = build_ioi_histogram(&iois, config);

    // Step 3: Find peaks in histogram
    let peaks = find_histogram_peaks(&histogram, config);

    // Step 4: Select best peak (histogram-derived interval + cosmetic strength)
    let (histogram_interval_ms, old_confidence) = select_best_tempo(&peaks, &histogram, config);

    // Step 5: Octave-correct the interval. The tallest IOI bin is often a
    // ½× or 2× octave of the true beat; pick the octave that aligns best.
    let folded_interval_ms = fold_octave(onsets, histogram_interval_ms, config);

    // Step 5b: Sub-bin refinement. The histogram bins are ~8ms wide, and using
    // the bin *center* leaves the interval off by up to half a bin. On a long
    // performance that error accumulates into a whole-beat drift, so we sweep a
    // fine grid within one bin width of the folded interval and keep the
    // interval whose grid best lands on the onsets. This is what makes the beat
    // grid actually FOLLOW the performance (and makes confidence honest).
    let best_interval_ms = refine_interval(onsets, folded_interval_ms, config);

    // Step 6: Convert interval to BPM
    let bpm = if best_interval_ms > 0.0 {
        60000.0 / best_interval_ms
    } else {
        120.0
    };

    // Step 7: Generate beat grid from the folded tempo
    let beat_positions_ms = generate_beat_grid(onsets, bpm, best_interval_ms);

    // Step 8: Honest confidence — blend the (cosmetic) histogram strength with
    // how well the beat grid actually lands on the onsets. `score_beat_alignment`
    // sums a per-beat Gaussian proximity; dividing by onset count normalizes a
    // perfectly periodic performance to ~1.0 and pulls jittered input down.
    let last_onset = onsets.last().map(|o| o.timestamp_ms).unwrap_or(0.0);
    let raw_alignment = best_phase_score(onsets, best_interval_ms, last_onset);
    let normalized_alignment = (raw_alignment / onsets.len() as f64).clamp(0.0, 1.0) as f32;
    let confidence = (0.25 * old_confidence + 0.75 * normalized_alignment).clamp(0.0, 1.0);

    let phase_offset_ms = beat_positions_ms.first().copied().unwrap_or(0.0);

    TempoEstimate {
        bpm: bpm.max(config.min_bpm).min(config.max_bpm),
        confidence,
        beat_positions_ms,
        phase_offset_ms,
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

/// Find peaks in the histogram using local maxima detection.
///
/// Edge bins (index 0 and the last bin) are eligible: their off-histogram
/// neighbour is treated as 0.0 so a tall bin at the very top or bottom of the
/// BPM range (e.g. ~180 BPM landing in bin 0) is no longer silently skipped.
/// Uses `>=` so plateaus qualify, and dedupes each run of equal values by
/// keeping only its first bin.
fn find_histogram_peaks(histogram: &[f32], _config: &TempoConfig) -> Vec<(usize, f32)> {
    let mut peaks = Vec::new();

    let mut i = 0;
    while i < histogram.len() {
        let left = if i == 0 { 0.0 } else { histogram[i - 1] };
        let right = if i + 1 == histogram.len() {
            0.0
        } else {
            histogram[i + 1]
        };

        if histogram[i] >= left && histogram[i] >= right && histogram[i] > 0.1 {
            peaks.push((i, histogram[i]));
            // Dedupe adjacent plateau bins: keep the first of any run of equal
            // values and skip past the rest of the run.
            let plateau = histogram[i];
            let mut j = i + 1;
            while j < histogram.len() && (histogram[j] - plateau).abs() < f32::EPSILON {
                j += 1;
            }
            i = j;
        } else {
            i += 1;
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

    // Use the bin *center* so the reported interval sits in the middle of the
    // bin's range rather than at its lower edge.
    let interval_ms = min_interval_ms + ((best_bin as f64 + 0.5) * bin_width);

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

/// Search 8 candidate phases (offsets) for the one whose beat grid best aligns
/// with the detected onsets. Returns `(best_phase, best_score)` where
/// `best_score` is the raw `score_beat_alignment` sum for that phase.
///
/// Shared by `generate_beat_grid` (uses the phase), `fold_octave` and the
/// confidence calculation (both use the score).
fn search_best_phase(onsets: &[Onset], interval_ms: f64, end_time: f64) -> (f64, f64) {
    if onsets.is_empty() || interval_ms <= 0.0 {
        return (0.0, 0.0);
    }

    let first_onset = onsets[0].timestamp_ms;
    let num_phase_tests = 8;
    let phase_step = interval_ms / num_phase_tests as f64;

    let mut best_phase = 0.0;
    let mut best_score = 0.0;

    for i in 0..num_phase_tests {
        let phase = first_onset + (i as f64 * phase_step);
        let score = score_beat_alignment(onsets, phase, interval_ms, end_time);

        if score > best_score {
            best_score = score;
            best_phase = phase;
        }
    }

    (best_phase, best_score)
}

/// Best per-phase alignment score for `interval_ms` (raw sum, not normalized).
fn best_phase_score(onsets: &[Onset], interval_ms: f64, end_time: f64) -> f64 {
    search_best_phase(onsets, interval_ms, end_time).1
}

/// Fraction of onsets that land within tolerance of *some* beat of the grid
/// defined by `interval_ms` at its best-aligning phase.
///
/// Unlike `score_beat_alignment` (which sums a per-beat proximity), coverage
/// counts each ONSET once — covered or not — so a candidate is judged by how
/// many onsets it *explains*, independent of how many beats it has. This is the
/// quantity that separates a ½× grid (whose beats land on only some of the
/// onsets) from the true grid (on which every onset lands). Uses the same
/// `interval * 0.15` tolerance as the alignment scorer for consistency.
fn onset_coverage(onsets: &[Onset], interval_ms: f64) -> f64 {
    if onsets.is_empty() || interval_ms <= 0.0 {
        return 0.0;
    }
    let last = onsets.last().map(|o| o.timestamp_ms).unwrap_or(0.0);
    let (phase, _) = search_best_phase(onsets, interval_ms, last);
    let tolerance_ms = interval_ms * 0.15;
    let covered = onsets
        .iter()
        .filter(|o| {
            // Distance from this onset to the NEAREST beat of the grid.
            let k = ((o.timestamp_ms - phase) / interval_ms).round();
            let beat = phase + k * interval_ms;
            (o.timestamp_ms - beat).abs() <= tolerance_ms
        })
        .count();
    covered as f64 / onsets.len() as f64
}

/// Choose between the histogram's interval and its ½×/2× octaves by scoring
/// each candidate's per-beat alignment against the onsets.
///
/// The histogram's IOI peak is prone to octave errors: fast content (e.g.
/// eighth notes) makes the sub-beat interval the tallest bin, doubling the BPM.
/// We score the {½× BPM, 1× BPM, 2× BPM} candidates by *per-beat* alignment
/// (raw score / beat count) so a shorter interval isn't rewarded merely for
/// having more beats to hit. A mild 1.05 prior keeps the histogram's own pick
/// when scores tie. Candidates outside [min_bpm, max_bpm] are skipped.
///
/// # Onset-coverage weighting (half-time fix)
/// Per-beat scoring alone has a half-time bias on sparse *in-range* content.
/// Concretely, test-pattern.wav (4 onsets ~500ms apart, true ≈120 BPM): the ½×
/// candidate at ~61 BPM (~983ms beats) lands a beat on every OTHER onset, so its
/// per-beat *average* is ~1.0, while the correct 121 BPM candidate — with only
/// ~3 beats of material — is dragged down by the beats that fall in the gaps
/// between the sparse onsets. So per-beat normalization alone folds it to ~61 BPM
/// even though that grid leaves half the onsets unexplained. The bias also bites
/// when the *histogram's own* pick is already the half-time interval (real-audio
/// test-8bar-progression.wav: 60 BPM pick has coverage 0.28, the correct 120 BPM
/// double has coverage 0.55, yet 60 wins on per-beat average).
///
/// Fix: multiply each candidate's per-beat alignment by its onset COVERAGE — the
/// fraction of onsets that land within tolerance of *some* beat of that grid
/// (see `onset_coverage`). Coverage counts onsets-explained, not beats-hit, so a
/// grid that abandons onsets in the gaps (coverage 0.5) can no longer out-score
/// one that explains them all (coverage 1.0) merely by having fewer beats. This
/// directly encodes the invariant: a candidate that explains FEWER of the onsets
/// must not out-score one that explains all of them.
///
/// Why multiply (not an eligibility gate) and why it passes BOTH folding tests:
/// - `eighth_note_content_folds_to_base_tempo` (273ms eighths, true 110 BPM): the
///   histogram's in-range pick is the 546ms quarter (110 BPM); its ½× (1091ms,
///   55 BPM) and 2× (273ms, 220 BPM) octaves both fall OUTSIDE [min_bpm, max_bpm]
///   and are skipped, so only the correct 1× competes — coverage weighting is a
///   no-op here and 110 BPM stands. (The brief's worry that offbeat eighths give
///   the 1× grid coverage ~0.5 is moot: with no in-range rival, scaling the sole
///   candidate can't change the winner.)
/// - `sparse_quarter_notes_do_not_fold_to_half_time` (test-pattern onsets): the
///   ½× 60 BPM grid (coverage 0.5) is multiplied down below the 121 BPM grid
///   (coverage 1.0), so it no longer wins. An eligibility gate keyed to the 1×
///   pick would fix THIS case but NOT the 8bar case above (there the low-coverage
///   candidate IS the 1× baseline); multiplying every candidate by its own
///   coverage handles both symmetrically.
///
/// # Deferred (spec §4.2)
/// The spec also asks to "prefer the candidate in the theme's stated BPM range
/// when scores are close." That is not implementable here: `estimate_tempo`'s
/// signature is fixed and carries no theme, so `fold_octave` has no access to a
/// theme's BPM range. Theme-aware preference would require plumbing the theme
/// into `estimate_tempo`; until then the generic ×1.05 prior for the histogram's
/// own 1× pick stands in for that tie-breaking bias. Tracked for a later task.
fn fold_octave(onsets: &[Onset], interval_ms: f64, config: &TempoConfig) -> f64 {
    if onsets.is_empty() || interval_ms <= 0.0 {
        return interval_ms;
    }

    let last = onsets.last().map(|o| o.timestamp_ms).unwrap_or(0.0);
    let candidates = [interval_ms * 2.0, interval_ms, interval_ms * 0.5]; // ½×, 1×, 2× BPM
    let mut best = (interval_ms, f64::MIN);

    for &cand in &candidates {
        let bpm = 60000.0 / cand;
        if bpm < config.min_bpm || bpm > config.max_bpm {
            continue;
        }
        // Per-beat average so long intervals aren't penalized for having fewer
        // beats to align, then weighted by coverage so a grid that leaves onsets
        // unexplained can't win on that average alone (the half-time guard).
        let raw = best_phase_score(onsets, cand, last);
        let beats = (last / cand).max(1.0);
        let coverage = onset_coverage(onsets, cand);
        let mut score = (raw / beats) * coverage;
        if (cand - interval_ms).abs() < f64::EPSILON {
            score *= 1.05; // mild prior for the histogram's own pick
        }
        if score > best.1 {
            best = (cand, score);
        }
    }

    best.0
}

/// Refine a coarse (bin-quantized) interval to the sub-bin value whose beat
/// grid best aligns with the onsets.
///
/// The histogram's bin width is ~8ms; the reported bin center can be off from
/// the true beat interval by up to half a bin. Left uncorrected, that offset
/// accumulates into a whole-beat drift over a long performance. We sweep a fine
/// grid spanning ±1 bin width around the seed and keep the highest-scoring
/// interval, staying within [min_bpm, max_bpm].
fn refine_interval(onsets: &[Onset], seed_interval_ms: f64, config: &TempoConfig) -> f64 {
    if onsets.is_empty() || seed_interval_ms <= 0.0 {
        return seed_interval_ms;
    }

    let min_interval_ms = 60000.0 / config.max_bpm;
    let max_interval_ms = 60000.0 / config.min_bpm;
    let bin_width = (max_interval_ms - min_interval_ms) / config.histogram_bins as f64;
    let last = onsets.last().map(|o| o.timestamp_ms).unwrap_or(0.0);

    let lo = (seed_interval_ms - bin_width).max(min_interval_ms);
    let hi = (seed_interval_ms + bin_width).min(max_interval_ms);
    if hi <= lo {
        return seed_interval_ms;
    }

    let steps = 64;
    let mut best = (seed_interval_ms, best_phase_score(onsets, seed_interval_ms, last));
    for i in 0..=steps {
        let iv = lo + (hi - lo) * (i as f64 / steps as f64);
        let s = best_phase_score(onsets, iv, last);
        if s > best.1 {
            best = (iv, s);
        }
    }

    best.0
}

/// Generate beat grid positions based on estimated tempo
fn generate_beat_grid(onsets: &[Onset], _bpm: f64, interval_ms: f64) -> Vec<f64> {
    if onsets.is_empty() || interval_ms <= 0.0 {
        return Vec::new();
    }

    let last_onset = onsets[onsets.len() - 1].timestamp_ms;

    // Find best phase (offset)
    let (best_phase, _best_score) = search_best_phase(onsets, interval_ms, last_onset);

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

    /// Build `n` onsets evenly spaced `step` ms apart, starting at t=0.
    fn onsets_every_ms(step: f64, n: usize) -> Vec<Onset> {
        (0..n)
            .map(|i| Onset {
                timestamp_ms: i as f64 * step,
                strength: 1.0,
            })
            .collect()
    }

    /// Build `n` onsets nominally `step` ms apart, but with a deterministic
    /// zigzag jitter of `±j` ms (even indices +j, odd indices -j).
    fn onsets_every_ms_jittered(step: f64, n: usize, j: f64) -> Vec<Onset> {
        (0..n)
            .map(|i| {
                let base = i as f64 * step;
                let offset = if i % 2 == 0 { j } else { -j };
                Onset {
                    timestamp_ms: base + offset,
                    strength: 1.0,
                }
            })
            .collect()
    }

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

    #[test]
    fn eighth_note_content_folds_to_base_tempo() {
        // CAREFUL FIXTURE CHOICE: onsets every 250ms would NOT reproduce the bug — compute_iois
        // excludes intervals <= 250.0 (tempo.rs:121) and the all-to-all pairs put the strongest
        // peak at 500ms anyway. Use eighths at 110 BPM (273ms): 273 IS in the IOI window, becomes
        // the tallest histogram bin → naive BPM 219.8 → clamped to max_bpm=180 (tempo.rs:41,108).
        // After octave folding, the 546ms candidate (109.9 BPM) must win on per-beat alignment.
        let onsets = onsets_every_ms(273.0, 16);
        let est = estimate_tempo(&onsets, 44100);
        assert!(
            (est.bpm - 110.0).abs() < 5.0,
            "got {} (was 180.0 = clamped double-tempo before fix)",
            est.bpm
        );
    }

    #[test]
    fn sparse_content_keeps_base_over_double_tempo_candidate() {
        // Onsets every 750ms → histogram picks 750ms (80 BPM). Candidates: 1500ms (40 BPM — below
        // min_bpm 60, skipped), 750ms (80), 375ms (160 BPM — all onsets still align but per-beat
        // normalization halves its score). 80 must survive folding.
        let onsets = onsets_every_ms(750.0, 8);
        let est = estimate_tempo(&onsets, 44100);
        assert!((est.bpm - 80.0).abs() < 4.0, "got {}", est.bpm);
    }

    #[test]
    fn sparse_quarter_notes_do_not_fold_to_half_time() {
        // Mirrors test-pattern.wav's ACTUAL detected onsets (0/476/975/1474ms —
        // real detector jitter around a true ≈120 BPM 500ms grid). Perfectly-even
        // 500ms×4 does NOT reproduce the bug (the ×1.05 1× prior tips the tie), so
        // we use the real, slightly-jittered timings the detector emits.
        //
        // The half-time (½×) candidate at ~61 BPM (~983ms beats) lands one beat on
        // roughly every OTHER onset, so its per-beat *alignment average* is ~1.0 —
        // and with only ~3 beats of material the correct ~122 BPM candidate is
        // dragged down by the beats that fall in the gaps between the sparse onsets.
        // Per-beat scoring alone therefore folds this to ~61 BPM. The onset-COVERAGE
        // guard fixes it: at 122 BPM all 4 onsets sit on a beat (coverage 1.0); at
        // 61 BPM only ~2 of 4 do (coverage ~0.5), so the slower candidate — which
        // explains FEWER of the onsets — is no longer eligible to out-score the one
        // that explains all of them.
        let onsets: Vec<Onset> = [0.0, 476.0, 975.2, 1474.5]
            .iter()
            .map(|&t| Onset {
                timestamp_ms: t,
                strength: 1.0,
            })
            .collect();
        let est = estimate_tempo(&onsets, 44100);
        assert!(
            (est.bpm - 120.0).abs() < 8.0,
            "got {} (was ~61.0 = half-time fold before the coverage guard)",
            est.bpm
        );
    }


    #[test]
    fn confidence_is_not_cosmetic() {
        // Perfectly periodic → high; jittered ±80ms → strictly lower.
        let periodic = estimate_tempo(&onsets_every_ms(500.0, 12), 44100);
        let jittered = estimate_tempo(&onsets_every_ms_jittered(500.0, 12, 80.0), 44100); // deterministic zigzag ±80ms
        assert!(periodic.confidence > 0.8);
        assert!(jittered.confidence < periodic.confidence - 0.15);
    }

    #[test]
    fn edge_bins_are_eligible_peaks() {
        // All IOIs at ~333ms (≈180 BPM) land in bin 0 today and are skipped by `for i in 1..len-1`.
        let onsets = onsets_every_ms(334.0, 12);
        let est = estimate_tempo(&onsets, 44100);
        assert!(est.confidence > 0.0, "edge bin was skipped: confidence 0");
    }

    #[test]
    fn phase_offset_exposed_and_matches_first_beat() {
        let mut onsets = onsets_every_ms(500.0, 8);
        for o in &mut onsets {
            o.timestamp_ms += 320.0;
        } // leading silence
        let est = estimate_tempo(&onsets, 44100);
        assert!(
            (est.phase_offset_ms.rem_euclid(60000.0 / est.bpm)
                - 320.0_f64.rem_euclid(60000.0 / est.bpm))
            .abs()
                < 40.0
        );
    }
}
