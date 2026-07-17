//! Causal streaming onset detection + classification — the live twin of the
//! offline pipeline in [`crate::features`] / [`crate::analyze_offline`].
//!
//! # Why a separate detector
//!
//! The offline detector ([`crate::features::detect_onsets`]) is *acausal*: it
//! computes whole-file flux statistics (mean + 2σ over every frame) and slides a
//! large 2048/512 STFT. That is the right call for a file you already have, but
//! it cannot run on a live mic — you do not have the future, and a 2048-sample
//! window (~46ms at 44.1kHz) is too much latency for a jam. This module is the
//! *causal* counterpart the AudioWorklet drives one render quantum at a time.
//!
//! # Design deltas vs offline (spec §5.1)
//!
//! | Aspect                | Offline                         | Streaming (here)                          |
//! |-----------------------|---------------------------------|-------------------------------------------|
//! | STFT window / hop     | 2048 / 512                      | 512 / 256 (lower latency)                 |
//! | Adaptive threshold    | mean + 2σ over the WHOLE file   | mean + 2σ over a rolling 2s flux window   |
//! | Peak picking          | flux[i-1] < flux[i] > flux[i+1] over all frames | same, but confirmed 1 hop late (~6ms)     |
//! | Classification window | fixed [onset, onset+150ms] (both paths) | fixed [onset, onset+`feature_window_ms`], deferred |
//! | Kick fallback         | parallel RMS-envelope detector  | causal energy-rise detector               |
//! | Leading onset (t≈0)   | first-10ms RMS gate             | same                                       |
//!
//! # The onset-timing convention (READ THIS before touching alignment)
//!
//! Both detectors' spectral flux peaks when the transient sits near the CENTER
//! of the analysis window, but both *report* the window's LEFT EDGE
//! (`frame_index * hop`). So the reported time is systematically early by
//! ~`window/2`. Measured on the fixtures, offline reports a transient at true
//! time `S` as `S − 24ms` (its `window/2` = 23.2ms plus ~1ms of flux group
//! delay). Offline is the source of truth (spec §5.1), so to land inside the
//! ±20ms tolerance band the streaming detector — whose own window is only
//! 512 (`window/2` ≈ 5.8ms) — must report using OFFLINE's convention, i.e. it
//! estimates the true onset from its own window centre and then subtracts
//! [`StreamingConfig::onset_align_ms`] to match offline's early-reporting bias.
//! Without this, streaming would be ~18-24ms LATE relative to offline and fail
//! the tolerance test. This offset is calibrated against the fixtures, not
//! guessed; see `tests/streaming_tolerance.rs`.
//!
//! # Latency
//!
//! `push` is causal. A confirmed onset is emitted after the classification
//! window fills: ~`feature_window_ms` after the true onset (plus one hop for
//! peak confirmation). `t_ms` on the returned [`LiveEvent`] is the onset's
//! *estimated* time (offline-aligned), NOT the emission time.

use std::collections::VecDeque;

use crate::events::types::{EventClass, EventFeatures};
use crate::events::{CalibrationProfile, CalibrationSample, HybridClassifier};
use crate::features::{apply_hann_window, compute_fft, extract_features, extract_mfcc};

/// A classified event emitted by the streaming detector.
///
/// The streaming analogue of [`crate::Event`], minus the random UUID and the
/// forward-looking `duration_ms` (a live detector cannot know how long the note
/// lasts until the next one arrives). `t_ms` is the onset's estimated time using
/// the offline reporting convention (see module docs), so `t_ms` values line up
/// with [`crate::Event::timestamp_ms`] within tolerance.
#[derive(Debug, Clone)]
pub struct LiveEvent {
    /// Estimated onset time in milliseconds from the start of the stream,
    /// using offline's reporting convention (see module docs).
    pub t_ms: f64,
    /// Classified event type.
    pub class: EventClass,
    /// Classification confidence in `[0.0, 1.0]`.
    pub confidence: f32,
    /// Features extracted from the classification window.
    pub features: EventFeatures,
    /// Mean MFCCs (c1..c20) of the classification window — forwarded so a
    /// calibration echo-back carries the full Gaussian feature vector.
    pub mfcc: Vec<f32>,
}

/// Tunable parameters for [`StreamingDetector`].
///
/// Defaults mirror the offline flux MATH with the brief's streaming parameters
/// (512/256) and are calibrated against the fixture corpus so streaming matches
/// offline within ±20ms / same-class on ≥95% of onsets. Change with care and
/// re-run `cargo test -p beatrice-dsp streaming`.
#[derive(Debug, Clone)]
pub struct StreamingConfig {
    /// STFT window size in samples. Offline uses 2048; streaming uses 512 for
    /// latency (spec §5.1).
    pub window_size: usize,
    /// Hop between STFT frames in samples. Offline uses 512; streaming 256.
    pub hop_size: usize,
    /// Adaptive-threshold multiplier: `threshold = mean + factor * σ` over the
    /// rolling flux window. Mirrors [`crate::OnsetConfig::threshold_factor`].
    pub threshold_factor: f32,
    /// Rolling flux-statistics window length in milliseconds (offline uses the
    /// whole file; §5.1 specifies 2s here).
    pub stats_window_ms: f64,
    /// Minimum time between onsets in milliseconds (refractory). Mirrors
    /// [`crate::OnsetConfig::min_onset_gap_ms`].
    pub min_onset_gap_ms: f64,
    /// Absolute minimum flux for an onset candidate — gates out low-energy noise
    /// between beats when the rolling mean/σ are both tiny.
    pub min_flux: f32,
    /// Length of the (forward) classification window in milliseconds, measured
    /// from the estimated true onset. Emission is deferred until this much
    /// post-onset audio is in the ring, so features are comparable to offline's.
    pub feature_window_ms: f64,
    /// Offline-convention alignment offset in milliseconds (see module docs).
    /// The estimated true onset time is reduced by this to match offline's
    /// early left-edge reporting.
    pub onset_align_ms: f64,
    /// RMS threshold on the first 10ms for a leading onset at t≈0. Mirrors
    /// [`crate::features`]'s `detect_leading_onset`.
    pub leading_rms_threshold: f32,
    /// Energy-rise fallback: current short-window RMS must exceed this multiple
    /// of the rolling energy floor to fire (catches low-frequency kicks that the
    /// high-bin-biased flux under-weights). Mirrors offline's `3.0`.
    pub energy_rise_factor: f32,
    /// Absolute minimum RMS for the energy fallback to consider a frame.
    pub energy_min_rms: f32,
}

impl Default for StreamingConfig {
    fn default() -> Self {
        StreamingConfig {
            window_size: 512,
            hop_size: 256,
            threshold_factor: 2.0,
            stats_window_ms: 2000.0,
            min_onset_gap_ms: 120.0,
            min_flux: 0.5,
            // Matches the Gaussian factory model's training window
            // (HYBRID_MFCC_WINDOW_MS): the model learned 150ms timbre stats, and
            // classifying over a different window measurably costs accuracy
            // (AVP: 80.5% @100ms vs 81.6% @150ms). The extra 50ms of emission
            // deferral is fine for the visual jam form (latency gate was NO-GO
            // for live synthesis anyway).
            feature_window_ms: crate::events::hybrid::HYBRID_MFCC_WINDOW_MS,
            // Calibrated against the fixture corpus (see tests/streaming_tolerance.rs
            // and the module docs). Offline's large 2048 window reports different
            // per-class biases: it lands near the true centre for low-frequency
            // kicks (wants align≈0) but ~17ms early for high-frequency hats (wants
            // align≈17). 12ms is the compromise that keeps BOTH classes inside the
            // ±20ms band — the sweep plateau [10,14]ms all yield 99% corpus match.
            onset_align_ms: 12.0,
            leading_rms_threshold: 0.02,
            energy_rise_factor: 3.0,
            energy_min_rms: 0.03,
        }
    }
}

/// An onset whose peak is confirmed but whose classification window has not yet
/// filled — held until `feature_window_ms` of post-onset audio arrives.
struct PendingOnset {
    /// Estimated true-onset absolute sample index (window centre of peak frame).
    onset_abs: usize,
    /// Absolute sample index at which the classification window is full.
    ready_abs: usize,
    /// Reported time in ms (offline-aligned), computed at confirmation time.
    t_ms: f64,
}

/// Causal onset + classification detector for the live worklet.
///
/// Feed render quanta (any chunk size) to [`push`](Self::push); it returns any
/// [`LiveEvent`]s whose classification window completed during that call. See
/// the module docs for the design and the timing convention.
pub struct StreamingDetector {
    sample_rate: u32,
    cfg: StreamingConfig,

    /// Sample ring (last `ring_capacity` mono samples). `ring_start_abs` is the
    /// absolute index of `ring.front()`.
    ring: VecDeque<f32>,
    ring_capacity: usize,
    ring_start_abs: usize,
    /// Total samples ever pushed (absolute index of the next incoming sample).
    samples_seen: usize,

    /// Absolute sample index where the next STFT frame begins.
    next_frame_start: usize,
    /// Previous frame's magnitude spectrum (for flux differencing).
    prev_spectrum: Option<Vec<f32>>,

    /// Last three flux values for local-maximum peak confirmation:
    /// (value, absolute frame-start sample). `flux_win[1]` is the candidate.
    flux_win: VecDeque<(f32, usize)>,
    /// Rolling flux history for adaptive mean+σ statistics.
    flux_hist: VecDeque<f32>,
    flux_sum: f64,
    flux_sq_sum: f64,
    /// Max rolling flux samples (`stats_window_ms`).
    stats_capacity: usize,

    /// Rolling short-window RMS floor for the energy fallback.
    energy_hist: VecDeque<f32>,
    energy_sum: f64,
    energy_capacity: usize,

    /// Absolute sample index of the last emitted onset (refractory tracking).
    last_onset_abs: Option<usize>,
    /// Whether the leading-onset (t≈0) check has run.
    leading_checked: bool,

    /// Confirmed-but-not-yet-classified onsets, in arrival order.
    pending: VecDeque<PendingOnset>,

    /// The accumulating user calibration profile (Task 5). Samples are added
    /// live in jam mode; the source of truth for `adapted`.
    profile: CalibrationProfile,
    /// Hybrid classifier MAP-adapted to `profile`, rebuilt whenever samples
    /// change. `Some` only once the profile is sufficient (≥5 samples for all
    /// 4 classes), so a half-taught profile never overrides the factory model.
    adapted: Option<HybridClassifier>,
    /// The A/B toggle. When `true` AND `adapted` is `Some`, the MAP-adapted
    /// model classifies. When `false`, the factory model always wins — this is
    /// what the panel's FACTORY/YOURS switch flips.
    calibration_enabled: bool,
    /// The user-agnostic factory hybrid (AVP Gaussian + hum gate).
    factory: HybridClassifier,
}

impl StreamingDetector {
    /// Create a detector for the given sample rate with default (calibrated)
    /// config and the heuristic classifier.
    pub fn new(sample_rate: u32) -> Self {
        Self::with_config(sample_rate, StreamingConfig::default())
    }

    /// Create a detector with a custom [`StreamingConfig`].
    pub fn with_config(sample_rate: u32, cfg: StreamingConfig) -> Self {
        let sr = sample_rate.max(1) as f64;
        // 4s ring (spec §5.1) — big enough to hold any classification window and
        // the STFT history even if push() is called with large chunks.
        let ring_capacity = ((sr * 4.0) as usize).max(cfg.window_size * 4);
        let stats_capacity =
            ((cfg.stats_window_ms / 1000.0 * sr) as usize / cfg.hop_size.max(1)).max(4);
        // Energy floor over ~200ms, matching offline's local-average window.
        let energy_capacity = ((sr * 0.2) as usize / cfg.hop_size.max(1)).max(3);

        StreamingDetector {
            sample_rate,
            cfg,
            ring: VecDeque::with_capacity(ring_capacity + 4096),
            ring_capacity,
            ring_start_abs: 0,
            samples_seen: 0,
            next_frame_start: 0,
            prev_spectrum: None,
            flux_win: VecDeque::with_capacity(3),
            flux_hist: VecDeque::new(),
            flux_sum: 0.0,
            flux_sq_sum: 0.0,
            stats_capacity,
            energy_hist: VecDeque::new(),
            energy_sum: 0.0,
            energy_capacity,
            last_onset_abs: None,
            leading_checked: false,
            pending: VecDeque::new(),
            profile: CalibrationProfile::new("live".to_string()),
            adapted: None,
            calibration_enabled: false,
            factory: HybridClassifier::factory(),
        }
    }

    /// Create a detector seeded with a user [`CalibrationProfile`] and
    /// calibration ENABLED. If the profile is already sufficient the detector
    /// classifies with the MAP-adapted model out of the gate; an insufficient
    /// profile still falls through to the factory model until enough samples
    /// are added. This is the Task 5 personalization path — the worklet loads
    /// a persisted profile this way on jam start.
    pub fn with_profile(sample_rate: u32, profile: CalibrationProfile) -> Self {
        let mut det = Self::new(sample_rate);
        det.profile = profile;
        det.calibration_enabled = true;
        det.rebuild_adapted();
        det
    }

    /// The detector's sample rate (Hz).
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Add a labeled calibration sample to the live profile (Task 5). Rebuilds
    /// the MAP-adapted model; it takes over only once the profile becomes
    /// sufficient ([`CalibrationProfile::is_sufficient`]).
    pub fn add_calibration_sample(&mut self, sample: CalibrationSample) {
        self.profile.add_sample(sample);
        self.rebuild_adapted();
    }

    /// Flip the A/B toggle. `true` = personal (MAP-adapted when sufficient),
    /// `false` = factory model. Cheap — does not touch the profile.
    pub fn set_calibration_enabled(&mut self, enabled: bool) {
        self.calibration_enabled = enabled;
    }

    /// Drop the accumulated calibration profile and rebuild the adapted model
    /// (which becomes `None`, so classification falls back to the factory).
    ///
    /// Used when a re-teach begins: the worklet may have been re-seeded with a
    /// persisted profile on jam start, so `add_calibration_sample` would
    /// otherwise APPEND the new session's samples onto the old ones — drifting
    /// the live profile away from what the panel accumulates and later persists.
    /// Clearing first makes a re-teach start from a clean profile. The A/B
    /// toggle (`calibration_enabled`) is left untouched; with an empty profile
    /// `adapted` is `None`, so `classify` uses the factory model until enough
    /// new samples are taught.
    pub fn clear_calibration(&mut self) {
        self.profile = CalibrationProfile::new("live".to_string());
        self.rebuild_adapted();
    }

    /// Whether the accumulated profile has enough samples to personalize.
    pub fn is_calibration_sufficient(&self) -> bool {
        self.profile.is_sufficient()
    }

    /// Snapshot of the live calibration profile (for persistence).
    pub fn calibration_profile(&self) -> &CalibrationProfile {
        &self.profile
    }

    /// Rebuild the MAP-adapted hybrid from the current profile. `adapted` is
    /// `Some` only when the profile is sufficient, so an under-taught profile
    /// never overrides the factory model even with calibration enabled.
    fn rebuild_adapted(&mut self) {
        self.adapted = if self.profile.is_sufficient() {
            let samples: Vec<(EventClass, Vec<f32>)> = self
                .profile
                .samples
                .values()
                .flatten()
                .filter(|s| s.has_mfcc()) // legacy MFCC-less samples poison MAP
                .map(|s| (s.class, s.gaussian_vec()))
                .collect();
            Some(HybridClassifier::with_adaptation(&samples))
        } else {
            None
        };
    }

    /// Feed a chunk of mono samples (any length). Returns the events whose
    /// classification window completed during this call. Causal: an event's
    /// `t_ms` is its estimated onset, emitted ~`feature_window_ms` later.
    pub fn push(&mut self, samples: &[f32]) -> Vec<LiveEvent> {
        if !samples.is_empty() {
            self.ring.extend(samples.iter().copied());
            self.samples_seen += samples.len();
            self.trim_ring();
        }

        self.check_leading_onset();

        // Process every STFT frame that is now fully available.
        while self.next_frame_start + self.cfg.window_size <= self.samples_seen {
            self.process_frame();
            self.next_frame_start += self.cfg.hop_size;
        }

        // Single emission point: drain every pending onset whose classification
        // window has now filled. Registration only queues, so nothing is lost.
        let mut out = Vec::new();
        self.drain_ready(&mut out);
        out
    }

    /// End-of-stream: classify every still-pending onset from whatever audio
    /// has arrived. Call when the input stops — e.g. jam capture ends — so an
    /// onset within the last `feature_window_ms` of the stream is not lost.
    ///
    /// The window is TRIMMED to the audio that actually arrived (matching the
    /// offline pipeline's end-of-file clamp) rather than zero-padded: padding
    /// silent frames dilutes the MFCC mean and measurably shifts the verdict
    /// on short tails.
    pub fn flush(&mut self) -> Vec<LiveEvent> {
        let mut out = Vec::new();
        while let Some(p) = self.pending.pop_front() {
            let fw_samples =
                (self.cfg.feature_window_ms / 1000.0 * self.sample_rate as f64) as usize;
            let available = self.samples_seen.saturating_sub(p.onset_abs);
            let win = self.ring_slice(p.onset_abs, fw_samples.min(available).max(1));
            let features = extract_features(&win, self.sample_rate);
            let mfcc = extract_mfcc(&win, self.sample_rate);
            let (class, confidence) = self.classify(&features, &mfcc);
            out.push(LiveEvent { t_ms: p.t_ms, class, confidence, features, mfcc });
        }
        out
    }

    /// Drop the oldest samples once the ring exceeds capacity, keeping
    /// `ring_start_abs` in sync. We only trim samples that no pending onset (nor
    /// the STFT read head) still needs.
    fn trim_ring(&mut self) {
        if self.ring.len() <= self.ring_capacity {
            return;
        }
        let mut min_needed = self.next_frame_start;
        if let Some(p) = self.pending.front() {
            min_needed = min_needed.min(p.onset_abs);
        }
        let target_start = self.samples_seen.saturating_sub(self.ring_capacity);
        let new_start = target_start.min(min_needed);
        while self.ring_start_abs < new_start && !self.ring.is_empty() {
            self.ring.pop_front();
            self.ring_start_abs += 1;
        }
    }

    /// Read `len` samples of the ring starting at absolute index `abs`. Missing
    /// tail (not yet arrived) or head (already trimmed) is zero-padded.
    fn ring_slice(&self, abs: usize, len: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; len];
        for (k, slot) in out.iter_mut().enumerate() {
            let a = abs + k;
            if a >= self.ring_start_abs && a < self.samples_seen {
                if let Some(&s) = self.ring.get(a - self.ring_start_abs) {
                    *slot = s;
                }
            }
        }
        out
    }

    /// Leading-onset (t≈0) gate: if the first 10ms carries energy, offline emits
    /// an onset at t=0 (flux is 0 on the first frame, so neither detector's flux
    /// catches an attack that is already present at the start).
    fn check_leading_onset(&mut self) {
        if self.leading_checked {
            return;
        }
        let win = (self.sample_rate as f64 * 0.01) as usize; // 10ms
        if win == 0 || self.samples_seen < win {
            return; // wait for enough audio
        }
        self.leading_checked = true;
        let head = self.ring_slice(0, win);
        let rms = (head.iter().map(|s| s * s).sum::<f32>() / win as f32).sqrt();
        if rms > self.cfg.leading_rms_threshold {
            // Report at t=0 (offline's convention for a leading onset).
            self.register_onset(0, 0.0);
        }
    }

    /// Process one STFT frame at `next_frame_start`: compute causal flux, update
    /// rolling stats, confirm the previous frame as a peak if warranted, and run
    /// the energy-rise fallback.
    fn process_frame(&mut self) {
        let start = self.next_frame_start;
        let frame = self.ring_slice(start, self.cfg.window_size);

        // --- spectral flux (same rectified-flux math as offline) ---
        let mut windowed = frame.clone();
        apply_hann_window(&mut windowed);
        let spectrum = compute_fft(&windowed);
        let flux = match &self.prev_spectrum {
            Some(prev) => {
                let mut sum = 0.0f32;
                for (c, p) in spectrum.iter().zip(prev.iter()) {
                    let d = c - p;
                    if d > 0.0 {
                        sum += d;
                    }
                }
                sum
            }
            None => 0.0,
        };
        self.prev_spectrum = Some(spectrum);

        // Peak confirmation uses the stats as they stand BEFORE folding in this
        // frame's flux, so the candidate frame is judged against its own past
        // (causal) rather than a window that peeks at the peak itself.
        let (mean, std) = self.flux_stats();
        let threshold = (mean + self.cfg.threshold_factor as f64 * std).max(self.cfg.min_flux as f64);

        // Slide the 3-wide confirmation window: [i-1, i(candidate), i+1=this].
        self.flux_win.push_back((flux, start));
        while self.flux_win.len() > 3 {
            self.flux_win.pop_front();
        }
        if self.flux_win.len() == 3 {
            let prev = self.flux_win[0].0;
            let (cand, cand_start) = self.flux_win[1];
            let next = self.flux_win[2].0;
            let is_peak = cand > prev && cand > next;
            if is_peak && (cand as f64) > threshold {
                // Estimated true onset = centre of the candidate window.
                let onset_abs = cand_start + self.cfg.window_size / 2;
                self.try_register(onset_abs);
            }
        }

        // Fold this frame into the rolling flux stats AFTER using them.
        self.push_flux(flux);

        // --- energy-rise fallback (causal mirror of offline's RMS detector) ---
        self.energy_fallback(start);
    }

    /// Causal broadband-energy detector for low-frequency kicks that the
    /// high-bin-biased flux under-weights. Fires when the current short-window
    /// RMS both exceeds `energy_rise_factor` × the rolling floor and is a
    /// meaningful absolute level. Refractory + `try_register` de-dup against
    /// flux onsets, so this only adds onsets flux missed.
    fn energy_fallback(&mut self, start: usize) {
        let win = self.cfg.window_size;
        let frame = self.ring_slice(start, win);
        let rms = (frame.iter().map(|s| s * s).sum::<f32>() / win as f32).sqrt();

        let floor = if self.energy_hist.is_empty() {
            0.0
        } else {
            (self.energy_sum / self.energy_hist.len() as f64) as f32
        };
        let is_rise = floor > 0.0
            && rms / floor > self.cfg.energy_rise_factor
            && rms > self.cfg.energy_min_rms;
        if is_rise {
            let onset_abs = start + win / 2;
            self.try_register(onset_abs);
        }

        self.energy_hist.push_back(rms);
        self.energy_sum += rms as f64;
        while self.energy_hist.len() > self.energy_capacity {
            if let Some(old) = self.energy_hist.pop_front() {
                self.energy_sum -= old as f64;
            }
        }
    }

    /// Register an onset if the refractory window since the last one has
    /// elapsed. Computes the reported (offline-aligned) time and queues a
    /// pending classification.
    fn try_register(&mut self, onset_abs: usize) {
        let gap_samples = (self.cfg.min_onset_gap_ms * self.sample_rate as f64 / 1000.0) as usize;
        if let Some(last) = self.last_onset_abs {
            if onset_abs <= last || onset_abs - last < gap_samples {
                return;
            }
        }
        let t_ms = (onset_abs as f64 / self.sample_rate as f64 * 1000.0 - self.cfg.onset_align_ms)
            .max(0.0);
        self.register_onset(onset_abs, t_ms);
    }

    /// Queue a confirmed onset for deferred classification. Leading onsets pass
    /// `onset_abs = 0`, `t_ms = 0.0`. Emission is ALWAYS deferred to the single
    /// `drain_ready` at the end of `push` — registration never emits, so an
    /// onset whose window is already full (e.g. a huge chunk) is still drained
    /// exactly once and never lost.
    fn register_onset(&mut self, onset_abs: usize, t_ms: f64) {
        self.last_onset_abs = Some(onset_abs);
        let fw_samples = (self.cfg.feature_window_ms / 1000.0 * self.sample_rate as f64) as usize;
        let ready_abs = onset_abs + fw_samples;
        self.pending.push_back(PendingOnset { onset_abs, ready_abs, t_ms });
    }

    /// Emit any pending onsets whose classification window has filled.
    fn drain_ready(&mut self, out: &mut Vec<LiveEvent>) {
        while let Some(p) = self.pending.front() {
            if p.ready_abs > self.samples_seen {
                break;
            }
            let p = self.pending.pop_front().unwrap();
            let fw_samples =
                (self.cfg.feature_window_ms / 1000.0 * self.sample_rate as f64) as usize;
            let win = self.ring_slice(p.onset_abs, fw_samples.max(1));
            let features = extract_features(&win, self.sample_rate);
            let mfcc = extract_mfcc(&win, self.sample_rate);
            let (class, confidence) = self.classify(&features, &mfcc);
            out.push(LiveEvent { t_ms: p.t_ms, class, confidence, features, mfcc });
        }
    }

    /// Classify features + MFCCs through the hybrid model: the MAP-adapted
    /// model when calibration is enabled AND the profile is sufficient
    /// (`adapted` is `Some`), the factory model otherwise. This gate is what
    /// the A/B toggle flips:
    /// [`set_calibration_enabled`](Self::set_calibration_enabled).
    ///
    /// Public so the worklet's calibration UI can re-classify a probe/event
    /// through the live gate without re-running detection.
    pub fn classify(&self, f: &EventFeatures, mfcc: &[f32]) -> (EventClass, f32) {
        let clf = if self.calibration_enabled {
            self.adapted.as_ref().unwrap_or(&self.factory)
        } else {
            &self.factory
        };
        let r = clf.classify(f, mfcc);
        (r.class, r.confidence)
    }

    /// Rolling flux mean and (population) standard deviation.
    fn flux_stats(&self) -> (f64, f64) {
        let n = self.flux_hist.len();
        if n == 0 {
            return (0.0, 0.0);
        }
        let mean = self.flux_sum / n as f64;
        let var = (self.flux_sq_sum / n as f64 - mean * mean).max(0.0);
        (mean, var.sqrt())
    }

    /// Push a flux value into the rolling-stats window, evicting the oldest.
    fn push_flux(&mut self, flux: f32) {
        self.flux_hist.push_back(flux);
        self.flux_sum += flux as f64;
        self.flux_sq_sum += (flux as f64) * (flux as f64);
        while self.flux_hist.len() > self.stats_capacity {
            if let Some(old) = self.flux_hist.pop_front() {
                self.flux_sum -= old as f64;
                self.flux_sq_sum -= (old as f64) * (old as f64);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Synthesize a kick like `scripts/generate-test-audio.mjs::generateKick`
    /// (150→60Hz sweep, sharp exponential decay) so the unit test is hermetic.
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

    #[test]
    fn detects_synthetic_kick_within_25ms() {
        let audio = synth_kick(44_100, 0.2);
        let mut det = StreamingDetector::new(44_100);
        let mut events = Vec::new();
        for chunk in audio.chunks(128) {
            events.extend(det.push(chunk));
        }
        assert_eq!(events.len(), 1, "expected exactly one onset, got {}", events.len());
        assert!(events[0].t_ms.abs() < 25.0, "t_ms was {}", events[0].t_ms);
        assert_eq!(events[0].class, EventClass::BilabialPlosive);
    }

    #[test]
    fn flush_recovers_tail_onset_and_is_idempotent() {
        // A kick whose 150ms classification window CANNOT fill: the stream
        // ends 60ms after the onset. push() must hold it pending; flush()
        // must classify it from the trimmed window; a second flush is empty.
        let sr = 44_100u32;
        let mut audio = vec![0.0f32; (sr / 2) as usize]; // 500ms silence
        let kick = synth_kick(sr, 0.06); // 60ms of kick, then stream ends
        audio.extend_from_slice(&kick);
        let mut det = StreamingDetector::new(sr);
        let mut live = Vec::new();
        for chunk in audio.chunks(128) {
            live.extend(det.push(chunk));
        }
        assert!(live.is_empty(), "window never fills; push must not emit");
        let flushed = det.flush();
        assert_eq!(flushed.len(), 1, "flush must recover the pending onset");
        assert_eq!(flushed[0].class, EventClass::BilabialPlosive);
        assert!(det.flush().is_empty(), "flush must be idempotent");
    }

    #[test]
    fn silence_emits_nothing() {
        let mut det = StreamingDetector::new(44_100);
        let silence = vec![0.0f32; 44_100 * 2];
        let events: Vec<_> = silence.chunks(128).flat_map(|c| det.push(c)).collect();
        assert!(events.is_empty(), "silence produced {} events", events.len());
    }

    #[test]
    fn empty_push_is_safe() {
        let mut det = StreamingDetector::new(48_000);
        assert!(det.push(&[]).is_empty());
    }

    #[test]
    fn refractory_suppresses_double_trigger() {
        // Two kicks 40ms apart (inside the 120ms refractory) → one event.
        let sr = 44_100;
        let mut audio = synth_kick(sr, 0.2);
        let second = synth_kick(sr, 0.2);
        let offset = (sr as f64 * 0.04) as usize;
        if audio.len() < offset + second.len() {
            audio.resize(offset + second.len(), 0.0);
        }
        for (i, s) in second.iter().enumerate() {
            audio[offset + i] += *s;
        }
        let mut det = StreamingDetector::new(sr);
        let events: Vec<_> = audio.chunks(128).flat_map(|c| det.push(c)).collect();
        assert_eq!(events.len(), 1, "refractory should collapse to one onset");
    }

    #[test]
    fn whole_file_single_push_still_emits() {
        // Regression: registration must NOT emit; the single end-of-push
        // drain_ready must catch onsets whose window is already full when the
        // entire signal arrives in one giant chunk. Otherwise events are lost.
        let audio = synth_kick(44_100, 0.5);
        let mut det = StreamingDetector::new(44_100);
        let events = det.push(&audio); // one push, window long-since full
        assert_eq!(events.len(), 1, "one-shot push lost the onset");
        assert_eq!(events[0].class, EventClass::BilabialPlosive);
    }

    // ---- Task 5: few-shot calibration (kNN-first + heuristic fallback) ----

    use crate::events::CalibrationSample;

    /// A hihat-like feature vector. The heuristic classifies this HihatNoise
    /// (high centroid, high ZCR, high-band dominant).
    fn hihat_like() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 4500.0,
            zcr: 0.45,
            low_band_energy: 0.05,
            mid_band_energy: 0.25,
            high_band_energy: 0.70,
            peak_amplitude: 0.6,
            crest_factor: 3.0,
        }
    }

    fn kick_like() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 300.0,
            zcr: 0.05,
            low_band_energy: 0.70,
            mid_band_energy: 0.20,
            high_band_energy: 0.10,
            peak_amplitude: 0.8,
            crest_factor: 4.0,
        }
    }

    fn hum_like() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 600.0,
            zcr: 0.05,
            low_band_energy: 0.30,
            mid_band_energy: 0.45,
            high_band_energy: 0.25,
            peak_amplitude: 0.5,
            crest_factor: 1.5,
        }
    }

    /// A hihat-ish vector distinct enough from `hihat_like()` that a probe at
    /// `hihat_like()` has its 5 nearest neighbours all in the class we teach it.
    fn other_hat() -> EventFeatures {
        EventFeatures {
            spectral_centroid: 3200.0,
            zcr: 0.35,
            low_band_energy: 0.05,
            mid_band_energy: 0.40,
            high_band_energy: 0.55,
            peak_amplitude: 0.5,
            crest_factor: 3.0,
        }
    }

    fn teach(det: &mut StreamingDetector, class: EventClass, f: EventFeatures) {
        for _ in 0..5 {
            det.add_calibration_sample(CalibrationSample::with_mfcc(
                class,
                f.clone(),
                vec![0.0; crate::features::MFCC_COEFFS],
                vec![],
                44_100,
            ));
        }
    }

    /// Probe used across the calibration-gating tests. MFCCs are zero (these
    /// synthetic samples carry no raw audio), so the Gaussian sees only the
    /// zcr/crest dims move — which is exactly what the gating tests need: a
    /// deterministic, non-flaky difference between factory and adapted.
    fn probe() -> (EventFeatures, Vec<f32>) {
        (hihat_like(), vec![0.0; crate::features::MFCC_COEFFS])
    }

    #[test]
    fn detector_prefers_adapted_after_sufficient_calibration() {
        // Teach Beatrice — deliberately weird — that a hihat-like sound is a
        // "Click" (the panel's "make your KICK sound as a TSS" scenario). MAP
        // adaptation is intentionally gentler than the old kNN memorization
        // (5 samples move a class mean by 1/3, per the AVP-tuned tau=10), so
        // the contract is: the A/B toggle must CHANGE the verdict on the same
        // probe once the profile is sufficient — not necessarily flip its
        // class outright.
        let (pf, pm) = probe();
        let mut det = StreamingDetector::new(44_100);
        let factory_verdict = det.classify(&pf, &pm);

        // Not sufficient yet → factory verdict even when enabled.
        det.set_calibration_enabled(true);
        assert_eq!(det.classify(&pf, &pm), factory_verdict);

        teach(&mut det, EventClass::Click, hihat_like()); // the weird lesson
        teach(&mut det, EventClass::BilabialPlosive, kick_like());
        teach(&mut det, EventClass::HihatNoise, other_hat());
        teach(&mut det, EventClass::HumVoiced, hum_like());
        assert!(det.is_calibration_sufficient());

        // Calibration OFF → factory verdict.
        det.set_calibration_enabled(false);
        assert_eq!(
            det.classify(&pf, &pm),
            factory_verdict,
            "with calibration off the factory model should win"
        );

        // Calibration ON → the adapted model answers differently (the Click
        // mean moved 1/3 toward the probe, so its posterior visibly shifts).
        det.set_calibration_enabled(true);
        let adapted_verdict = det.classify(&pf, &pm);
        assert!(
            adapted_verdict.0 != factory_verdict.0
                || (adapted_verdict.1 - factory_verdict.1).abs() > 1e-4,
            "adaptation must change the verdict: factory {factory_verdict:?} vs adapted {adapted_verdict:?}"
        );
    }

    #[test]
    fn clear_calibration_reverts_to_factory() {
        // A re-teach begins on a detector that was re-seeded with a sufficient
        // profile. clear_calibration() must drop the profile so the SAME probe
        // reverts to the exact factory verdict — even with the A/B toggle
        // still ON. Then re-teaching from scratch must re-personalize.
        let (pf, pm) = probe();
        let mut det = StreamingDetector::new(44_100);
        let factory_verdict = det.classify(&pf, &pm);
        det.set_calibration_enabled(true);

        teach(&mut det, EventClass::Click, hihat_like()); // weird lesson
        teach(&mut det, EventClass::BilabialPlosive, kick_like());
        teach(&mut det, EventClass::HihatNoise, other_hat());
        teach(&mut det, EventClass::HumVoiced, hum_like());
        assert!(det.is_calibration_sufficient());
        let adapted_verdict = det.classify(&pf, &pm);
        assert!(
            adapted_verdict != factory_verdict,
            "sufficient calibration should change the verdict"
        );

        // Clear: profile emptied, adapted rebuilt to None → factory wins again
        // despite calibration_enabled staying true.
        det.clear_calibration();
        assert!(!det.is_calibration_sufficient(), "profile should be empty after clear");
        assert_eq!(
            det.classify(&pf, &pm),
            factory_verdict,
            "after clear, classify must fall back to the factory model"
        );

        // Re-teaching from the clean profile personalizes again.
        teach(&mut det, EventClass::Click, hihat_like());
        teach(&mut det, EventClass::BilabialPlosive, kick_like());
        teach(&mut det, EventClass::HihatNoise, other_hat());
        teach(&mut det, EventClass::HumVoiced, hum_like());
        assert!(det.is_calibration_sufficient());
        assert_eq!(det.classify(&pf, &pm), adapted_verdict);
    }

    #[test]
    fn with_profile_is_adapted_first() {
        // The brief's Step-1 shape: a pre-built sufficient profile makes the
        // detector personalized out of the gate — identical to teaching the
        // same samples live.
        // Mirror teach(): full zero-MFCC vectors so the seeded samples pass the
        // has_mfcc() MAP filter exactly as the live-taught ones do.
        let mut profile = CalibrationProfile::new("test".into());
        let seed = |p: &mut CalibrationProfile, class: EventClass, f: EventFeatures| {
            p.add_sample(CalibrationSample::with_mfcc(
                class,
                f,
                vec![0.0; crate::features::MFCC_COEFFS],
                vec![],
                44_100,
            ));
        };
        for _ in 0..5 {
            seed(&mut profile, EventClass::Click, hihat_like());
            seed(&mut profile, EventClass::BilabialPlosive, kick_like());
            seed(&mut profile, EventClass::HihatNoise, other_hat());
            seed(&mut profile, EventClass::HumVoiced, hum_like());
        }
        let (pf, pm) = probe();
        let seeded = StreamingDetector::with_profile(44_100, profile);

        let mut taught = StreamingDetector::new(44_100);
        taught.set_calibration_enabled(true);
        teach(&mut taught, EventClass::Click, hihat_like());
        teach(&mut taught, EventClass::BilabialPlosive, kick_like());
        teach(&mut taught, EventClass::HihatNoise, other_hat());
        teach(&mut taught, EventClass::HumVoiced, hum_like());

        assert_eq!(seeded.classify(&pf, &pm), taught.classify(&pf, &pm));
        // And it differs from factory (the profile actually took effect).
        let factory = StreamingDetector::new(44_100);
        assert!(seeded.classify(&pf, &pm) != factory.classify(&pf, &pm));
    }

    #[test]
    fn mfccless_legacy_samples_never_adapt_the_model() {
        // A sufficient profile of LEGACY (empty-mfcc) samples must leave the
        // model at factory — zero-MFCC vectors poison the MAP means otherwise.
        let (pf, pm) = probe();
        let mut det = StreamingDetector::new(44_100);
        let factory_verdict = det.classify(&pf, &pm);
        det.set_calibration_enabled(true);
        for (class, f) in [
            (EventClass::Click, hihat_like()),
            (EventClass::BilabialPlosive, kick_like()),
            (EventClass::HihatNoise, other_hat()),
            (EventClass::HumVoiced, hum_like()),
        ] {
            for _ in 0..5 {
                // ::new with empty raw_window derives an EMPTY mfcc (legacy shape)
                det.add_calibration_sample(CalibrationSample::new(class, f.clone(), vec![], 44_100));
            }
        }
        assert!(det.is_calibration_sufficient());
        assert_eq!(
            det.classify(&pf, &pm),
            factory_verdict,
            "legacy samples must not move the adapted model off factory"
        );
    }

    #[test]
    fn variable_chunk_sizes_are_stable() {
        // The same signal fed in 128- vs 512- vs 333-sample chunks yields the
        // same onset count and times (push must be chunk-size agnostic).
        let audio = synth_kick(44_100, 0.3);
        let run = |chunk: usize| -> Vec<f64> {
            let mut det = StreamingDetector::new(44_100);
            let mut ts = Vec::new();
            for c in audio.chunks(chunk) {
                for e in det.push(c) {
                    ts.push(e.t_ms);
                }
            }
            ts
        };
        let a = run(128);
        let b = run(512);
        let c = run(333);
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), c.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert!((x - y).abs() < 1e-6, "chunking changed t_ms: {x} vs {y}");
        }
        for (x, y) in a.iter().zip(c.iter()) {
            assert!((x - y).abs() < 1e-6, "chunking changed t_ms: {x} vs {y}");
        }
    }
}
