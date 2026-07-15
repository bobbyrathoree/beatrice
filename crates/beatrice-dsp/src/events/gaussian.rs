// Gaussian (diagonal-covariance QDA) event classifier.
//
// A tiny generative model over MFCC-based feature vectors: per class, a
// diagonal Gaussian in globally-standardized feature space, scored by
// log-likelihood + log-prior. Fit offline on the AVP dataset (see the
// `benchmark` bin), embedded as JSON, and MAP-adapted per user from a handful
// of labeled calibration samples.
//
// Why this model: on AVP (28 participants, leave-one-participant-out) it
// scores ~0.80 participant-wise vs ~0.66 for the hand-tuned rule classifier,
// while costing ~100 floats — small enough to embed in the WASM worklet and
// cheap enough to adapt on-device without training infrastructure.

use serde::{Deserialize, Serialize};

use crate::events::types::{ClassScore, EventClass, EventFeatures};

/// The factory model fitted on all 28 AVP participants (9,777 utterances) by
/// `benchmark --fit-model`. LOPO cross-validation estimates 79.8% user-agnostic
/// / 81.6% MAP-adapted participant-wise accuracy for this construction (vs
/// 65.8% for the rule heuristic). ~2 KB of JSON: cheap enough to embed in both
/// the native binary and the WASM worklet.
const FACTORY_MODEL_JSON: &str = include_str!("avp_factory_model.json");

/// Feature-vector dimensionality used by [`GaussianModel`]:
/// 20 MFCCs (c1..c20) + zero-crossing rate + crest factor.
pub const GAUSSIAN_DIMS: usize = crate::features::MFCC_COEFFS + 2;

/// Assemble the classifier's feature vector from extracted features.
///
/// Order is part of the model contract (a fitted model's means/vars are
/// indexed by it): `[mfcc1..mfcc20, zcr, crest_factor]`. Band energies and
/// centroid are deliberately excluded — on AVP they *hurt* (they encode the
/// recording chain as much as the sound), while MFCCs + zcr + crest carry the
/// discriminative timbre.
pub fn gaussian_features(f: &EventFeatures, mfcc: &[f32]) -> Vec<f32> {
    let mut v = Vec::with_capacity(GAUSSIAN_DIMS);
    for i in 0..crate::features::MFCC_COEFFS {
        v.push(mfcc.get(i).copied().unwrap_or(0.0));
    }
    v.push(f.zcr);
    v.push(f.crest_factor);
    v
}

/// Variance floor in standardized feature space. Prevents a degenerate
/// (near-constant) calibration dimension from dominating the log-likelihood.
const VAR_FLOOR: f32 = 1e-4;

/// Default MAP adaptation strength: the prior (factory) mean counts as this
/// many pseudo-samples when blending with a user's calibration samples.
/// Chosen on AVP leave-one-participant-out CV (tau=10 → 80.8% vs 80.2%
/// unadapted; small tau over-trusts 5 noisy samples and *loses* accuracy).
pub const DEFAULT_MAP_TAU: f32 = 10.0;

/// A diagonal-covariance Gaussian classifier over standardized features.
///
/// Serializable so a factory model fitted on AVP can be embedded as JSON and
/// user-adapted copies can be persisted alongside calibration profiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GaussianModel {
    /// Global standardization: (x - z_mean) / z_std, computed from the
    /// training corpus. Applied before any per-class scoring.
    pub z_mean: Vec<f32>,
    pub z_std: Vec<f32>,

    /// Classes in scoring order.
    pub classes: Vec<EventClass>,

    /// Per-class mean in standardized space, indexed like `classes`.
    pub means: Vec<Vec<f32>>,

    /// Per-class diagonal variance in standardized space (≥ [`VAR_FLOOR`]).
    pub vars: Vec<Vec<f32>>,

    /// Per-class log-prior, indexed like `classes`.
    pub log_priors: Vec<f32>,
}

impl GaussianModel {
    /// The embedded factory model fitted on the AVP dataset.
    ///
    /// Covers the three percussive classes (BilabialPlosive, HihatNoise,
    /// Click); AVP has no hum class, so HumVoiced stays with the heuristic's
    /// sustained-signal gate (see the classifier composition at the call
    /// sites). Panics only if the embedded JSON is corrupt, which the
    /// `factory_model_loads` test guards.
    pub fn factory() -> GaussianModel {
        GaussianModel::from_json(FACTORY_MODEL_JSON)
            .expect("embedded AVP factory model JSON is invalid")
    }

    /// Fit the model from `(class, feature_vector)` training examples.
    ///
    /// Returns `None` when there are no examples, any vector length differs,
    /// or a class ends up empty (callers control the class set via the data).
    pub fn fit(examples: &[(EventClass, Vec<f32>)]) -> Option<Self> {
        let dims = examples.first()?.1.len();
        if dims == 0 || examples.iter().any(|(_, v)| v.len() != dims) {
            return None;
        }
        let n = examples.len() as f32;

        // Global standardization stats.
        let mut z_mean = vec![0.0f32; dims];
        for (_, v) in examples {
            for (i, x) in v.iter().enumerate() {
                z_mean[i] += x / n;
            }
        }
        let mut z_std = vec![0.0f32; dims];
        for (_, v) in examples {
            for (i, x) in v.iter().enumerate() {
                z_std[i] += (x - z_mean[i]).powi(2) / n;
            }
        }
        for s in z_std.iter_mut() {
            *s = s.sqrt();
            if *s < 1e-9 {
                *s = 1.0; // constant dimension: pass through unscaled
            }
        }

        // Discover classes in first-seen order (stable across runs for the
        // same dataset ordering; the struct stores them explicitly anyway).
        let mut classes: Vec<EventClass> = Vec::new();
        for (c, _) in examples {
            if !classes.contains(c) {
                classes.push(*c);
            }
        }

        let mut means = vec![vec![0.0f32; dims]; classes.len()];
        let mut vars = vec![vec![0.0f32; dims]; classes.len()];
        let mut counts = vec![0usize; classes.len()];

        for (c, v) in examples {
            let k = classes.iter().position(|x| x == c).unwrap();
            counts[k] += 1;
            for i in 0..dims {
                means[k][i] += (v[i] - z_mean[i]) / z_std[i];
            }
        }
        for k in 0..classes.len() {
            if counts[k] == 0 {
                return None;
            }
            for m in means[k].iter_mut() {
                *m /= counts[k] as f32;
            }
        }
        for (c, v) in examples {
            let k = classes.iter().position(|x| x == c).unwrap();
            for i in 0..dims {
                let z = (v[i] - z_mean[i]) / z_std[i];
                vars[k][i] += (z - means[k][i]).powi(2);
            }
        }
        let mut log_priors = vec![0.0f32; classes.len()];
        for k in 0..classes.len() {
            for va in vars[k].iter_mut() {
                *va = (*va / counts[k] as f32).max(VAR_FLOOR);
            }
            log_priors[k] = (counts[k] as f32 / n).ln();
        }

        Some(GaussianModel {
            z_mean,
            z_std,
            classes,
            means,
            vars,
            log_priors,
        })
    }

    /// Standardize a raw feature vector into model space.
    fn standardize(&self, x: &[f32]) -> Vec<f32> {
        x.iter()
            .zip(self.z_mean.iter().zip(self.z_std.iter()))
            .map(|(v, (m, s))| (v - m) / s)
            .collect()
    }

    /// Classify a raw feature vector (as produced by [`gaussian_features`]).
    ///
    /// Returns the winning class, its posterior probability, and the full
    /// per-class posterior list (softmax over log-likelihood + log-prior),
    /// suitable for the UI's per-class score display.
    pub fn classify(&self, x: &[f32]) -> (EventClass, f32, Vec<ClassScore>) {
        let z = self.standardize(x);
        let mut lls: Vec<f32> = Vec::with_capacity(self.classes.len());
        for k in 0..self.classes.len() {
            let mut ll = self.log_priors[k];
            for ((zi, mi), vi) in z.iter().zip(&self.means[k]).zip(&self.vars[k]) {
                let d = zi - mi;
                ll -= 0.5 * (d * d / vi + vi.ln());
            }
            lls.push(ll);
        }
        // Softmax → posteriors.
        let mx = lls.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let exps: Vec<f32> = lls.iter().map(|&l| (l - mx).exp()).collect();
        let sum: f32 = exps.iter().sum();
        let posteriors: Vec<f32> = exps.iter().map(|e| e / sum.max(1e-12)).collect();

        let best = posteriors
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(i, _)| i)
            .unwrap_or(0);

        let scores = self
            .classes
            .iter()
            .zip(posteriors.iter())
            .map(|(&class, &score)| ClassScore { class, score })
            .collect();

        (self.classes[best], posteriors[best], scores)
    }

    /// MAP-adapt the class means toward a user's labeled calibration samples.
    ///
    /// Each class mean becomes `(n·user_mean + tau·factory_mean) / (n + tau)`
    /// where `n` is that user's sample count for the class; variances and
    /// priors stay at factory values (5-sample variance estimates are noise).
    /// Classes with no samples are unchanged. `tau` defaults to
    /// [`DEFAULT_MAP_TAU`].
    pub fn map_adapt(&self, samples: &[(EventClass, Vec<f32>)], tau: f32) -> GaussianModel {
        let mut adapted = self.clone();
        for (k, &class) in self.classes.iter().enumerate() {
            let user: Vec<Vec<f32>> = samples
                .iter()
                .filter(|(c, _)| *c == class)
                .map(|(_, v)| self.standardize(v))
                .collect();
            if user.is_empty() {
                continue;
            }
            let n = user.len() as f32;
            let dims = self.means[k].len();
            let mut user_mean = vec![0.0f32; dims];
            for u in &user {
                for (um, ui) in user_mean.iter_mut().zip(u) {
                    *um += ui / n;
                }
            }
            for (am, (um, fm)) in adapted.means[k]
                .iter_mut()
                .zip(user_mean.iter().zip(&self.means[k]))
            {
                *am = (n * um + tau * fm) / (n + tau);
            }
        }
        adapted
    }

    /// Serialize to JSON (for embedding / persistence).
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two well-separated synthetic clusters in 2D.
    fn two_cluster_examples() -> Vec<(EventClass, Vec<f32>)> {
        let mut ex = Vec::new();
        for i in 0..20 {
            let j = i as f32 * 0.01;
            ex.push((EventClass::BilabialPlosive, vec![0.0 + j, 1.0 - j]));
            ex.push((EventClass::HihatNoise, vec![5.0 + j, -4.0 - j]));
        }
        ex
    }

    #[test]
    fn fit_and_classify_separable_clusters() {
        let model = GaussianModel::fit(&two_cluster_examples()).unwrap();
        let (c1, p1, scores) = model.classify(&[0.1, 0.9]);
        assert_eq!(c1, EventClass::BilabialPlosive);
        assert!(p1 > 0.9, "posterior too low: {p1}");
        assert_eq!(scores.len(), 2);
        let (c2, p2, _) = model.classify(&[5.1, -4.2]);
        assert_eq!(c2, EventClass::HihatNoise);
        assert!(p2 > 0.9);
    }

    #[test]
    fn fit_rejects_bad_input() {
        assert!(GaussianModel::fit(&[]).is_none());
        // mismatched dims
        let bad = vec![
            (EventClass::Click, vec![1.0, 2.0]),
            (EventClass::Click, vec![1.0]),
        ];
        assert!(GaussianModel::fit(&bad).is_none());
    }

    #[test]
    fn posteriors_sum_to_one() {
        let model = GaussianModel::fit(&two_cluster_examples()).unwrap();
        let (_, _, scores) = model.classify(&[2.0, -1.0]);
        let total: f32 = scores.iter().map(|s| s.score).sum();
        assert!((total - 1.0).abs() < 1e-4, "posteriors sum to {total}");
    }

    #[test]
    fn map_adapt_shifts_toward_user() {
        let model = GaussianModel::fit(&two_cluster_examples()).unwrap();
        // A user whose "plosive" sits midway toward the hihat cluster.
        let user_samples = vec![
            (EventClass::BilabialPlosive, vec![2.5, -1.5]),
            (EventClass::BilabialPlosive, vec![2.6, -1.4]),
            (EventClass::BilabialPlosive, vec![2.4, -1.6]),
            (EventClass::BilabialPlosive, vec![2.5, -1.5]),
            (EventClass::BilabialPlosive, vec![2.5, -1.5]),
        ];
        // Factory model calls this point hihat-ish; the adapted model must
        // pull the plosive mean close enough to win.
        let adapted = model.map_adapt(&user_samples, 1.0);
        let (c, _, _) = adapted.classify(&[2.5, -1.5]);
        assert_eq!(c, EventClass::BilabialPlosive);
        // Unadapted classes stay put.
        let k_hh = adapted
            .classes
            .iter()
            .position(|c| *c == EventClass::HihatNoise)
            .unwrap();
        assert_eq!(adapted.means[k_hh], model.means[k_hh]);
    }

    #[test]
    fn map_adapt_large_tau_stays_near_factory() {
        let model = GaussianModel::fit(&two_cluster_examples()).unwrap();
        let user_samples = vec![(EventClass::BilabialPlosive, vec![100.0, -100.0])];
        let adapted = model.map_adapt(&user_samples, 1e6);
        let k = 0;
        for (a, b) in adapted.means[k].iter().zip(model.means[k].iter()) {
            assert!((a - b).abs() < 0.01);
        }
    }

    #[test]
    fn factory_model_loads() {
        let model = GaussianModel::factory();
        assert_eq!(model.z_mean.len(), GAUSSIAN_DIMS);
        assert_eq!(model.classes.len(), 3, "AVP covers the 3 percussive classes");
        assert!(model.classes.contains(&EventClass::BilabialPlosive));
        assert!(model.classes.contains(&EventClass::HihatNoise));
        assert!(model.classes.contains(&EventClass::Click));
        // A plausible kick-ish vector must classify without panicking.
        let x = vec![0.0f32; GAUSSIAN_DIMS];
        let (_, p, scores) = model.classify(&x);
        assert!(p > 0.0 && p <= 1.0);
        assert_eq!(scores.len(), 3);
    }

    #[test]
    fn json_round_trip() {
        let model = GaussianModel::fit(&two_cluster_examples()).unwrap();
        let json = model.to_json().unwrap();
        let back = GaussianModel::from_json(&json).unwrap();
        assert_eq!(back.classes, model.classes);
        assert_eq!(back.means, model.means);
        let (c, _, _) = back.classify(&[0.1, 0.9]);
        assert_eq!(c, EventClass::BilabialPlosive);
    }

    #[test]
    fn gaussian_features_order_and_padding() {
        let f = EventFeatures {
            spectral_centroid: 1000.0,
            zcr: 0.25,
            low_band_energy: 0.3,
            mid_band_energy: 0.4,
            high_band_energy: 0.3,
            peak_amplitude: 0.5,
            crest_factor: 4.2,
        };
        let n = crate::features::MFCC_COEFFS;
        let mfcc: Vec<f32> = (0..n).map(|i| i as f32).collect();
        let v = gaussian_features(&f, &mfcc);
        assert_eq!(v.len(), GAUSSIAN_DIMS);
        assert_eq!(v[0], 0.0);
        assert_eq!(v[n - 1], (n - 1) as f32);
        assert_eq!(v[n], 0.25);
        assert_eq!(v[n + 1], 4.2);
        // Short MFCC vectors are zero-padded, never a panic.
        let v2 = gaussian_features(&f, &[]);
        assert_eq!(v2.len(), GAUSSIAN_DIMS);
        assert_eq!(v2[0], 0.0);
    }
}
