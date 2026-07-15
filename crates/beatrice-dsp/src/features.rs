// Spectral feature extraction and onset detection
// Implements Spectral Flux (Superflux algorithm) for onset detection
// and extracts features for event classification

use realfft::RealFftPlanner;

use crate::ingest::AudioData;
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
    /// Prevents duplicate detections within a single beat
    /// A typical beatbox "ba" sound lasts 100-200ms, so this should be
    /// large enough to avoid detecting sub-events within a single beat
    pub min_onset_gap_ms: f64,

    /// Minimum spectral flux value required for an onset candidate.
    /// Frames with flux below this absolute threshold are ignored
    /// regardless of the adaptive threshold. This gates out low-energy
    /// noise between beats.
    pub min_flux_threshold: f32,
}

impl Default for OnsetConfig {
    fn default() -> Self {
        OnsetConfig {
            window_size: 2048,
            hop_size: 512,
            threshold_factor: 2.0, // Require flux to be 2.0 std devs above mean
            min_onset_gap_ms: 120.0, // Increased to 120ms to prevent double-triggers on human plosives
            min_flux_threshold: 0.0, // Computed dynamically if left at 0.0
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

    // Calculate peak amplitude (loudness indicator for velocity/dynamics)
    let peak_amplitude = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

    // Calculate RMS and crest factor (peak/RMS)
    // High crest factor = transient (plosive), low = sustained (hum)
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    let crest_factor = if rms > 1e-6 { peak_amplitude / rms } else { 0.0 };

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
        peak_amplitude,
        crest_factor,
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

/// Apply Hann window function to reduce spectral leakage.
///
/// Exposed to the crate so the causal [`crate::streaming::StreamingDetector`]
/// windows its STFT frames with the EXACT same taper as the offline flux path
/// (spec §5.1: "same rectified-flux math as offline, causal"). Duplicating the
/// window formula would risk silent drift between the two detectors.
pub(crate) fn apply_hann_window(samples: &mut [f32]) {
    let n = samples.len();

    // Guard against empty or single-sample arrays
    if n == 0 {
        return;
    }

    for (i, sample) in samples.iter_mut().enumerate() {
        let window_val = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / n as f32).cos());
        *sample *= window_val;
    }
}

/// Compute real FFT and return magnitude spectrum.
///
/// Exposed to the crate so the streaming detector's per-frame flux uses the
/// identical `realfft` magnitude spectrum as the offline path.
pub(crate) fn compute_fft(samples: &[f32]) -> Vec<f32> {
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(samples.len());

    let mut input = samples.to_vec();
    let mut spectrum = fft.make_output_vec();

    fft.process(&mut input, &mut spectrum).unwrap();

    // Convert complex spectrum to magnitudes
    spectrum.iter().map(|c| c.norm()).collect()
}

/// Calculate spectral centroid (center of mass of spectrum)
/// Uses energy (magnitude²) weighting to emphasize peaks over noise floor.
/// Without energy weighting, broadband noise across ~1000 FFT bins overwhelms
/// the few concentrated signal peaks, pulling the centroid to ~Nyquist/2.
/// Returns frequency in Hz
fn calculate_spectral_centroid(spectrum: &[f32], sample_rate: u32, window_size: usize) -> f32 {
    // Guard against zero window size
    if window_size == 0 {
        return 0.0;
    }

    let mut weighted_sum = 0.0;
    let mut total_energy = 0.0;

    let bin_width = sample_rate as f32 / window_size as f32;

    for (i, &magnitude) in spectrum.iter().enumerate() {
        let energy = magnitude * magnitude;
        let frequency = i as f32 * bin_width;
        weighted_sum += frequency * energy;
        total_energy += energy;
    }

    if total_energy > 0.0 {
        weighted_sum / total_energy
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
    // Low band captures beatbox kick fundamentals (80-400Hz) and voiced sounds
    // Mid band captures snare/click transients and upper harmonics
    // High band captures hi-hat/cymbal noise
    let low_max_hz = 500.0;
    let mid_max_hz = 4000.0;

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

    // Check for energy at the very start of the audio.
    let leading_onset = detect_leading_onset(&mono, audio.sample_rate);

    // Compute spectral flux across all frames
    let flux = compute_spectral_flux(&mono, audio.sample_rate, config);

    if flux.is_empty() {
        return leading_onset.into_iter().collect();
    }

    // Spectral flux onset detection (good for mid/high-frequency transients)
    let mut onsets = pick_onset_peaks(&flux, audio.sample_rate, config);

    // Broadband energy onset detection (catches low-frequency transients like kicks)
    // Spectral flux is biased toward high-frequency changes because high bins outnumber
    // low bins. This parallel detector uses RMS energy in short windows to catch
    // amplitude transients at any frequency.
    let energy_onsets = detect_energy_onsets(&mono, audio.sample_rate, config);
    for eo in energy_onsets {
        // Only add if not too close to an existing onset
        let too_close = onsets.iter().any(|o| (o.timestamp_ms - eo.timestamp_ms).abs() < config.min_onset_gap_ms);
        if !too_close {
            onsets.push(eo);
        }
    }

    // Sort by timestamp
    onsets.sort_by(|a, b| a.timestamp_ms.partial_cmp(&b.timestamp_ms).unwrap());

    // Prepend the leading onset if it doesn't overlap with the first detected onset
    if let Some(leading) = leading_onset {
        let too_close = onsets.first().is_some_and(|first| first.timestamp_ms < config.min_onset_gap_ms);
        if !too_close {
            onsets.insert(0, leading);
        }
    }

    onsets
}

/// Check if audio starts with significant energy (onset at t=0).
/// Returns Some(Onset) if the RMS of the first 10ms exceeds a threshold.
fn detect_leading_onset(mono: &[f32], sample_rate: u32) -> Option<Onset> {
    let window_samples = (sample_rate as f64 * 0.01) as usize; // 10ms
    if mono.len() < window_samples || window_samples == 0 {
        return None;
    }

    let rms: f32 = (mono[..window_samples].iter().map(|s| s * s).sum::<f32>() / window_samples as f32).sqrt();

    // Threshold: if the first 10ms has RMS > 0.02, there's an onset at t=0
    if rms > 0.02 {
        Some(Onset {
            timestamp_ms: 0.0,
            strength: (rms * 10.0).min(1.0), // normalize roughly
        })
    } else {
        None
    }
}

/// Detect onsets via broadband energy envelope.
/// Complements spectral flux by catching low-frequency transients (kicks/bass)
/// that spectral flux misses due to high-frequency bin count bias.
///
/// Algorithm: compute RMS in short windows, find frames where energy jumps
/// significantly above the local average (using a ratio threshold).
fn detect_energy_onsets(samples: &[f32], sample_rate: u32, config: &OnsetConfig) -> Vec<Onset> {
    let hop_size = config.hop_size;
    let window_size = config.hop_size * 2; // ~23ms at 44.1kHz with hop=512

    if samples.len() < window_size || hop_size == 0 {
        return Vec::new();
    }

    let num_frames = (samples.len() - window_size) / hop_size + 1;
    if num_frames < 3 {
        return Vec::new();
    }

    // Compute RMS energy per frame
    let mut energies: Vec<f32> = Vec::with_capacity(num_frames);
    for i in 0..num_frames {
        let start = i * hop_size;
        let end = (start + window_size).min(samples.len());
        let rms = (samples[start..end].iter().map(|s| s * s).sum::<f32>() / (end - start) as f32).sqrt();
        energies.push(rms);
    }

    // Compute local average energy using a sliding window of ~200ms
    let avg_window = (sample_rate as usize / hop_size / 5).max(3); // ~200ms
    let mut onsets = Vec::new();
    let min_gap_frames = ((config.min_onset_gap_ms * sample_rate as f64 / 1000.0) as usize) / hop_size;
    let mut last_onset_frame: usize = 0;

    for i in 1..energies.len() {
        // Local average over preceding frames
        let avg_start = i.saturating_sub(avg_window);
        let local_avg: f32 = energies[avg_start..i].iter().sum::<f32>() / (i - avg_start) as f32;

        // Onset if current energy is significantly above local average
        // and is a local maximum
        let is_peak = energies[i] > energies[i - 1]
            && (i + 1 >= energies.len() || energies[i] >= energies[i + 1]);
        let is_strong = local_avg > 0.0 && energies[i] / local_avg > 3.0;
        let abs_threshold = energies[i] > 0.03; // minimum absolute energy
        let gap_ok = i.saturating_sub(last_onset_frame) >= min_gap_frames;

        if is_peak && is_strong && abs_threshold && gap_ok {
            let timestamp_ms = (i * hop_size) as f64 * 1000.0 / sample_rate as f64;
            onsets.push(Onset {
                timestamp_ms,
                strength: (energies[i] / local_avg / 10.0).min(1.0),
            });
            last_onset_frame = i;
        }
    }

    onsets
}

/// Compute spectral flux for all frames
/// Spectral flux = sum of positive differences between consecutive magnitude spectra
fn compute_spectral_flux(
    samples: &[f32],
    _sample_rate: u32,
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
    let adaptive_threshold = mean + config.threshold_factor * std_dev;

    // Compute a minimum flux gate: if the caller did not set one (0.0),
    // derive one from the median flux so that low-energy noise frames
    // are never promoted to onsets. The median is more robust than the
    // mean because it is not skewed by a few loud transients.
    let min_flux = if config.min_flux_threshold > 0.0 {
        config.min_flux_threshold
    } else {
        let mut sorted_flux: Vec<f32> = flux.iter().copied().filter(|&v| v > 0.0).collect();
        if sorted_flux.is_empty() {
            0.0
        } else {
            sorted_flux.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let median = sorted_flux[sorted_flux.len() / 2];
            // Require at least 1.2x the median non-zero flux as an absolute floor
            median * 1.2
        }
    };

    // The effective threshold is the higher of the adaptive threshold
    // and the minimum flux gate
    let threshold = adaptive_threshold.max(min_flux);

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
                strength: strength.clamp(0.0, 1.0),
            });

            last_onset_frame = i;
        }
    }

    onsets
}

/// Number of MFCC coefficients produced by [`extract_mfcc`] (c1..c20; c0 —
/// overall log-energy — is dropped so the vector is recording-level invariant).
/// 20 coefficients beat 13 on AVP leave-one-participant-out CV (81.6% vs
/// 80.8% for the Gaussian classifier) — the extra coefficients carry the
/// fine spectral envelope that separates snare from hi-hat imitations.
pub const MFCC_COEFFS: usize = 20;

/// Number of triangular mel filters in the MFCC filterbank.
const MFCC_MEL_FILTERS: usize = 40;

/// MFCC frame length in samples (~23 ms at 44.1 kHz) and hop (50% overlap).
const MFCC_FRAME: usize = 1024;
const MFCC_HOP: usize = 512;

/// Hz → mel (HTK formula).
fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

/// mel → Hz (HTK formula).
fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10.0f32.powf(mel / 2595.0) - 1.0)
}

/// Extract mean MFCCs (c1..c13) over an audio segment.
///
/// Classic "bag of frames" timbre descriptor: the segment is cut into ~23 ms
/// Hann-windowed frames (50% overlap), each frame's power spectrum is pooled
/// through a 40-filter mel filterbank, log-compressed, and DCT-II'd; the
/// per-frame coefficient vectors are then averaged. c0 (overall energy) is
/// dropped so the result does not depend on recording level — this is the
/// published recipe behind classical MFCC + kNN vocal-percussion classifiers.
///
/// Returns a zero vector for empty input (mirrors [`EventFeatures::zero`]).
pub fn extract_mfcc(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    extract_mfcc_stats(samples, sample_rate, MFCC_COEFFS).0
}

/// Full MFCC statistics: per-coefficient (mean, standard deviation) across the
/// segment's frames, for the first `n_coeffs` coefficients (c1..cN, c0 dropped).
/// The std vector captures temporal dynamics that the mean flattens.
pub fn extract_mfcc_stats(
    samples: &[f32],
    sample_rate: u32,
    n_coeffs: usize,
) -> (Vec<f32>, Vec<f32>) {
    if samples.is_empty() || sample_rate == 0 || n_coeffs == 0 {
        return (vec![0.0; n_coeffs], vec![0.0; n_coeffs]);
    }

    // Precompute the mel filterbank for this frame size / sample rate.
    // Filter edges are MFCC_MEL_FILTERS + 2 points evenly spaced in mel
    // from 0 to Nyquist.
    let n_bins = MFCC_FRAME / 2 + 1;
    let bin_width = sample_rate as f32 / MFCC_FRAME as f32;
    let mel_max = hz_to_mel(sample_rate as f32 / 2.0);
    let edges: Vec<f32> = (0..MFCC_MEL_FILTERS + 2)
        .map(|i| mel_to_hz(mel_max * i as f32 / (MFCC_MEL_FILTERS + 1) as f32))
        .collect();

    let mut sum_coeffs = vec![0.0f64; n_coeffs];
    let mut sumsq_coeffs = vec![0.0f64; n_coeffs];
    let mut n_frames = 0usize;

    let mut start = 0;
    loop {
        // Zero-pad the final partial frame so short segments still yield MFCCs.
        let mut frame = vec![0.0f32; MFCC_FRAME];
        let end = (start + MFCC_FRAME).min(samples.len());
        if start >= samples.len() {
            break;
        }
        frame[..end - start].copy_from_slice(&samples[start..end]);

        apply_hann_window(&mut frame);
        let spectrum = compute_fft(&frame);

        // Pool the power spectrum through the triangular mel filters.
        let mut filter_energies = vec![0.0f32; MFCC_MEL_FILTERS];
        for (m, energy) in filter_energies.iter_mut().enumerate() {
            let (f_lo, f_c, f_hi) = (edges[m], edges[m + 1], edges[m + 2]);
            let bin_lo = (f_lo / bin_width).floor() as usize;
            let bin_hi = ((f_hi / bin_width).ceil() as usize).min(n_bins - 1);
            for bin in bin_lo..=bin_hi {
                let f = bin as f32 * bin_width;
                let weight = if f <= f_c {
                    if f_c > f_lo { (f - f_lo) / (f_c - f_lo) } else { 0.0 }
                } else if f_hi > f_c {
                    (f_hi - f) / (f_hi - f_c)
                } else {
                    0.0
                };
                if weight > 0.0 {
                    let mag = spectrum[bin];
                    *energy += weight * mag * mag;
                }
            }
        }

        // Log-compress and DCT-II; keep c1..c13 (drop level-dependent c0).
        // The log floor is RELATIVE to the frame's peak filter energy (80 dB
        // below it): an absolute floor would pin near-silent filters while a
        // gain change shifts the rest, leaking level into c1+ and breaking the
        // level invariance that dropping c0 is supposed to buy.
        let peak_energy = filter_energies.iter().cloned().fold(0.0f32, f32::max);
        let floor = (peak_energy * 1e-8).max(f32::MIN_POSITIVE);
        let log_energies: Vec<f32> =
            filter_energies.iter().map(|&e| e.max(floor).ln()).collect();
        let n = MFCC_MEL_FILTERS as f32;
        for k in 0..n_coeffs {
            let mut c = 0.0f32;
            for (i, &le) in log_energies.iter().enumerate() {
                c += le
                    * (std::f32::consts::PI * (k + 1) as f32 * (i as f32 + 0.5) / n).cos();
            }
            sum_coeffs[k] += c as f64;
            sumsq_coeffs[k] += (c as f64) * (c as f64);
        }
        n_frames += 1;

        if end >= samples.len() {
            break;
        }
        start += MFCC_HOP;
    }

    if n_frames == 0 {
        return (vec![0.0; n_coeffs], vec![0.0; n_coeffs]);
    }
    let nf = n_frames as f64;
    let means: Vec<f32> = sum_coeffs.iter().map(|&s| (s / nf) as f32).collect();
    let stds: Vec<f32> = sum_coeffs
        .iter()
        .zip(sumsq_coeffs.iter())
        .map(|(&s, &ss)| {
            let mean = s / nf;
            ((ss / nf - mean * mean).max(0.0)).sqrt() as f32
        })
        .collect();
    (means, stds)
}

/// Extract mean MFCCs for a specific time window of decoded audio
/// (the MFCC counterpart of [`extract_features_for_window`]).
pub fn extract_mfcc_for_window(audio: &AudioData, start_ms: f64, duration_ms: f64) -> Vec<f32> {
    let start_sample = ((start_ms / 1000.0) * audio.sample_rate as f64) as usize;
    let duration_samples = ((duration_ms / 1000.0) * audio.sample_rate as f64) as usize;

    let mono = audio.to_mono();
    let end_sample = (start_sample + duration_samples).min(mono.len());

    if start_sample >= mono.len() || start_sample >= end_sample {
        return vec![0.0; MFCC_COEFFS];
    }

    extract_mfcc(&mono[start_sample..end_sample], audio.sample_rate)
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
    fn test_mfcc_empty_input() {
        let mfcc = extract_mfcc(&[], 44100);
        assert_eq!(mfcc.len(), MFCC_COEFFS);
        assert!(mfcc.iter().all(|&c| c == 0.0));
    }

    #[test]
    fn test_mfcc_length_and_finiteness() {
        // 100ms of a 440Hz sine
        let sr = 44100u32;
        let samples: Vec<f32> = (0..4410)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / sr as f32).sin() * 0.5)
            .collect();
        let mfcc = extract_mfcc(&samples, sr);
        assert_eq!(mfcc.len(), MFCC_COEFFS);
        assert!(mfcc.iter().all(|c| c.is_finite()));
        // A pure tone must produce non-trivial coefficients
        assert!(mfcc.iter().any(|&c| c.abs() > 0.01));
    }

    #[test]
    fn test_mfcc_discriminates_tone_from_noise() {
        // MFCCs of a low sine and of white-ish noise must differ substantially —
        // that separation is the whole reason the calibration kNN uses them.
        let sr = 44100u32;
        let tone: Vec<f32> = (0..4410)
            .map(|i| (2.0 * std::f32::consts::PI * 200.0 * i as f32 / sr as f32).sin() * 0.5)
            .collect();
        // Deterministic pseudo-noise (LCG) — no rand dep.
        let mut state = 12345u64;
        let noise: Vec<f32> = (0..4410)
            .map(|_| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                ((state >> 33) as f32 / (u32::MAX >> 1) as f32) - 1.0
            })
            .collect();
        let m_tone = extract_mfcc(&tone, sr);
        let m_noise = extract_mfcc(&noise, sr);
        let dist: f32 = m_tone
            .iter()
            .zip(m_noise.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum::<f32>()
            .sqrt();
        assert!(dist > 1.0, "tone/noise MFCC distance too small: {dist}");
    }

    #[test]
    fn test_mfcc_level_invariance() {
        // Dropping c0 should make MFCCs (nearly) invariant to gain changes.
        let sr = 44100u32;
        let quiet: Vec<f32> = (0..4410)
            .map(|i| (2.0 * std::f32::consts::PI * 300.0 * i as f32 / sr as f32).sin() * 0.05)
            .collect();
        let loud: Vec<f32> = quiet.iter().map(|s| s * 10.0).collect();
        let m_q = extract_mfcc(&quiet, sr);
        let m_l = extract_mfcc(&loud, sr);
        for (a, b) in m_q.iter().zip(m_l.iter()) {
            assert!((a - b).abs() < 0.15, "gain changed MFCC: {a} vs {b}");
        }
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
