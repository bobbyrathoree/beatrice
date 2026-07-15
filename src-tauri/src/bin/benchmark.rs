//! AVP benchmark runner — participant-wise heuristic vs calibrated accuracy.
//!
//! Measures Beatrice's event classifier against the published AVP
//! ("Amateur Vocal Percussion") dataset (Delgado et al., Zenodo, CC-BY), which
//! uses the exact same 4-class taxonomy Beatrice targets. The runner reports
//! two numbers side by side, both on the same held-out eval set:
//!   1. the rule-based `HeuristicClassifier` (no personalization), and
//!   2. a per-participant kNN calibration (first N utterances/class → profile).
//!
//! The dataset is NOT bundled. Download it from Zenodo, then point `--dataset`
//! at the extracted folder. Run `benchmark --help` for the expected layout.
//!
//! ```text
//! cargo run --release --bin benchmark -- --dataset ~/datasets/AVP --out avp-results.md
//! ```

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use beatrice_lib::audio::{self, AudioData};
use beatrice_lib::events::{
    gaussian_features, CalibrationProfile, CalibrationSample, EventClass, EventFeatures,
    GaussianModel, HeuristicClassifier, HybridClassifier, KnnClassifier, DEFAULT_MAP_TAU,
};

/// Feature window (ms) extracted around each annotated onset. Fixed so every
/// utterance is analyzed identically; sits inside the app's dynamic
/// [50, 500]ms clamp (see `commands.rs` `detect_events`).
const FEATURE_WINDOW_MS: f64 = 150.0;

/// Default number of utterances *per class per participant* fed into the
/// calibration profile. The rest of that participant's utterances form the
/// eval set. Matches `CalibrationProfile::is_sufficient` (≥5/class).
const DEFAULT_CALIB_PER_CLASS: usize = 5;

/// kNN neighbor count for the calibrated pass.
const KNN_K: usize = 5;

/// All four classes Beatrice discriminates, in a stable report order.
const CLASSES: [EventClass; 4] = [
    EventClass::BilabialPlosive,
    EventClass::HihatNoise,
    EventClass::Click,
    EventClass::HumVoiced,
];

const HELP: &str = "\
benchmark — AVP participant-wise accuracy runner

USAGE:
    benchmark --dataset <DIR> [--out <FILE>] [--calib-per-class <N>] [--window-ms <MS>]

OPTIONS:
    --dataset <DIR>          Path to the extracted AVP dataset (required).
    --out <FILE>             Markdown report output path (default: avp-results.md).
    --calib-per-class <N>    Calibration utterances per class per participant
                             (default: 5). The rest form the eval set.
    --window-ms <MS>         Feature window around each onset (default: 150).
    --dump-features <FILE>   Also write every item's features + split as CSV
                             (for offline error analysis / tuning).
    --fit-model <FILE>       Fit the Gaussian factory model on ALL participants
                             and write it as JSON (the embeddable artifact).
    -h, --help               Print this help.

EXPECTED DATASET LAYOUT:
    The AVP dataset (Delgado et al., \"Amateur Vocal Percussion\", Zenodo,
    CC-BY) is NOT bundled. Download it, extract it, and point --dataset at the
    folder holding one sub-directory per participant:

        <dataset>/
          <participant_id>/          one directory per participant (28 total)
            <name>.wav               recording(s)
            <name>.csv               annotation, SAME stem as its .wav

    Each annotation CSV is a list of rows, one per utterance:

        <onset_seconds>,<class_label>

    where <class_label> is one of the AVP labels:
        kd   kick drum        -> BilabialPlosive
        sd   snare drum       -> Click
        hhc  closed hi-hat    -> HihatNoise
        hho  open hi-hat      -> HihatNoise   (folded: Beatrice has no open-hat
                                               class; hho is reported separately)
    A header row (non-numeric first column) is tolerated and skipped. Unknown
    labels are counted and skipped.

PROTOCOL:
    Accuracy is participant-wise (matches Delgado): the mean over participants
    of each participant's per-utterance accuracy. Both the heuristic and the
    calibrated classifier are scored on the SAME held-out eval set (every
    utterance after the first N per class per participant), so the comparison
    is apples-to-apples. Calibration examples come from the same participant
    (that is the point of personalization) but are excluded from that
    participant's eval set.
";

// ---------------------------------------------------------------------------
// Pure, unit-tested core: mapping, parsing, splitting, aggregation.
// None of these touch the network or (except where noted) the filesystem.
// ---------------------------------------------------------------------------

/// A single annotated utterance: an onset within a WAV, its participant, and
/// the Beatrice class it maps to. `avp_raw` preserves the original AVP label so
/// the report can count open-hat (`hho`) folding.
#[derive(Debug, Clone)]
struct Item {
    participant: String,
    wav_path: PathBuf,
    onset_ms: f64,
    label: EventClass,
    avp_raw: String,
}

/// Map an AVP class label to Beatrice's taxonomy.
///
/// `hho` (open hi-hat) folds onto `HihatNoise` because Beatrice has no
/// open-hat class; the caller counts hho separately for the report caveat.
fn map_avp_class(label: &str) -> Option<EventClass> {
    match label.trim().to_lowercase().as_str() {
        "kd" => Some(EventClass::BilabialPlosive),
        "sd" => Some(EventClass::Click),
        "hhc" => Some(EventClass::HihatNoise),
        "hho" => Some(EventClass::HihatNoise),
        _ => None,
    }
}

/// Parse an AVP annotation stream into `(onset_seconds, raw_label)` rows.
///
/// Tolerates a header row (skips any row whose first field is not a number)
/// and blank/short rows. Kept generic over `Read` so it is unit-tested with an
/// in-memory string — no dataset required.
fn parse_annotation_rows<R: Read>(reader: R) -> Vec<(f64, String)> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(reader);

    let mut rows = Vec::new();
    for record in rdr.records().flatten() {
        if record.len() < 2 {
            continue;
        }
        let onset = match record[0].parse::<f64>() {
            Ok(v) => v,
            Err(_) => continue, // header or malformed row
        };
        let label = record[1].to_string();
        rows.push((onset, label));
    }
    rows
}

/// Turn parsed annotation rows into `Item`s for one WAV, dropping unknown
/// labels. Returns `(items, skipped_unknown_count)`.
fn rows_to_items(
    rows: &[(f64, String)],
    participant: &str,
    wav_path: &Path,
) -> (Vec<Item>, usize) {
    let mut items = Vec::new();
    let mut skipped = 0usize;
    for (onset_sec, raw) in rows {
        match map_avp_class(raw) {
            Some(label) => items.push(Item {
                participant: participant.to_string(),
                wav_path: wav_path.to_path_buf(),
                onset_ms: onset_sec * 1000.0,
                label,
                avp_raw: raw.trim().to_lowercase(),
            }),
            None => skipped += 1,
        }
    }
    (items, skipped)
}

/// Index-based split core (see `participant_split`). Takes the first
/// `n_per_class` items of *each* (participant, class) in encounter order into
/// the calibration set; the remainder go to eval.
fn participant_split_indices(items: &[Item], n_per_class: usize) -> (Vec<usize>, Vec<usize>) {
    let mut calib = Vec::new();
    let mut eval = Vec::new();
    let mut seen: HashMap<(&str, EventClass), usize> = HashMap::new();

    for (i, it) in items.iter().enumerate() {
        let count = seen.entry((it.participant.as_str(), it.label)).or_insert(0);
        if *count < n_per_class {
            calib.push(i);
        } else {
            eval.push(i);
        }
        *count += 1;
    }
    (calib, eval)
}

/// Participant-wise calib/eval split (borrowing wrapper over
/// `participant_split_indices`, used by the split tests).
///
/// The first `n_per_class` utterances of each class within each participant
/// become that participant's calibration examples; everything else is eval.
/// Calibration and eval never share an item (guaranteed by index disjointness).
#[cfg(test)]
fn participant_split(items: &[Item], n_per_class: usize) -> (Vec<&Item>, Vec<&Item>) {
    let (calib_idx, eval_idx) = participant_split_indices(items, n_per_class);
    (
        calib_idx.into_iter().map(|i| &items[i]).collect(),
        eval_idx.into_iter().map(|i| &items[i]).collect(),
    )
}

/// Mean over participants of each participant's accuracy (correct / total).
/// Participants with zero eval items are ignored (they contribute no accuracy).
fn mean_participant_accuracy(per_participant: &[(usize, usize)]) -> f64 {
    let accs: Vec<f64> = per_participant
        .iter()
        .filter(|(_, total)| *total > 0)
        .map(|(correct, total)| *correct as f64 / *total as f64)
        .collect();
    if accs.is_empty() {
        return 0.0;
    }
    accs.iter().sum::<f64>() / accs.len() as f64
}

/// Confusion matrix keyed by `(truth, predicted)`.
type Confusion = HashMap<(EventClass, EventClass), usize>;

/// Precision for one class: correct predictions of `c` / all predictions of `c`.
fn precision(conf: &Confusion, c: EventClass) -> Option<f64> {
    let tp = *conf.get(&(c, c)).unwrap_or(&0);
    let predicted: usize = CLASSES.iter().map(|&t| *conf.get(&(t, c)).unwrap_or(&0)).sum();
    if predicted == 0 {
        None
    } else {
        Some(tp as f64 / predicted as f64)
    }
}

/// Recall for one class: correct predictions of `c` / all true `c`.
fn recall(conf: &Confusion, c: EventClass) -> Option<f64> {
    let tp = *conf.get(&(c, c)).unwrap_or(&0);
    let actual: usize = CLASSES.iter().map(|&p| *conf.get(&(c, p)).unwrap_or(&0)).sum();
    if actual == 0 {
        None
    } else {
        Some(tp as f64 / actual as f64)
    }
}

/// Short human label used in report tables.
fn class_label(c: EventClass) -> &'static str {
    match c {
        EventClass::BilabialPlosive => "kd → BilabialPlosive",
        EventClass::HihatNoise => "hhc/hho → HihatNoise",
        EventClass::Click => "sd → Click",
        EventClass::HumVoiced => "(none) → HumVoiced",
    }
}

// ---------------------------------------------------------------------------
// Filesystem scan + feature extraction (dataset-dependent; not unit-tested).
// ---------------------------------------------------------------------------

/// Scan the dataset directory into a flat list of `Item`s.
///
/// Layout: `<dataset>/<participant>/<name>.csv` paired with a `<name>.wav` in
/// the same directory. Returns a helpful error string on any structural
/// problem so the runner can fail gracefully.
fn scan_dataset(dataset: &Path) -> Result<(Vec<Item>, usize), String> {
    if !dataset.exists() {
        return Err(format!(
            "dataset path does not exist: {}\n\nRun `benchmark --help` for the expected layout.",
            dataset.display()
        ));
    }
    if !dataset.is_dir() {
        return Err(format!(
            "dataset path is not a directory: {}",
            dataset.display()
        ));
    }

    let mut participant_dirs: Vec<PathBuf> = std::fs::read_dir(dataset)
        .map_err(|e| format!("cannot read dataset dir {}: {e}", dataset.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    participant_dirs.sort();

    if participant_dirs.is_empty() {
        return Err(format!(
            "no participant sub-directories found under {}.\n\nExpected one directory per \
             participant. Run `benchmark --help` for the layout.",
            dataset.display()
        ));
    }

    let mut items = Vec::new();
    let mut skipped_unknown = 0usize;

    for dir in &participant_dirs {
        let participant = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "unknown".to_string());

        let mut csv_paths: Vec<PathBuf> = std::fs::read_dir(dir)
            .map_err(|e| format!("cannot read participant dir {}: {e}", dir.display()))?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("csv"))
            .collect();
        csv_paths.sort();

        for csv_path in csv_paths {
            let wav_path = csv_path.with_extension("wav");
            if !wav_path.exists() {
                eprintln!(
                    "warning: annotation {} has no matching .wav (expected {}); skipping",
                    csv_path.display(),
                    wav_path.display()
                );
                continue;
            }
            let file = std::fs::File::open(&csv_path)
                .map_err(|e| format!("cannot open {}: {e}", csv_path.display()))?;
            let rows = parse_annotation_rows(file);
            let (mut new_items, skipped) = rows_to_items(&rows, &participant, &wav_path);
            skipped_unknown += skipped;
            items.append(&mut new_items);
        }
    }

    if items.is_empty() {
        return Err(format!(
            "found {} participant dir(s) but no usable annotated utterances under {}.\n\
             Check that each .csv sits beside a same-named .wav and uses the \
             `<onset_seconds>,<label>` format (see --help).",
            participant_dirs.len(),
            dataset.display()
        ));
    }

    Ok((items, skipped_unknown))
}

/// Extract features for every item, reusing a per-WAV audio cache so each file
/// is decoded once. Aligned by index with `items`.
fn extract_all_features(items: &[Item], window_ms: f64) -> Result<Vec<EventFeatures>, String> {
    let mut cache: HashMap<PathBuf, AudioData> = HashMap::new();
    let mut feats = Vec::with_capacity(items.len());

    for it in items {
        if !cache.contains_key(&it.wav_path) {
            let bytes = std::fs::read(&it.wav_path)
                .map_err(|e| format!("cannot read {}: {e}", it.wav_path.display()))?;
            let audio = audio::ingest_wav(&bytes)
                .map_err(|e| format!("cannot decode {}: {e}", it.wav_path.display()))?;
            cache.insert(it.wav_path.clone(), audio);
        }
        let audio = &cache[&it.wav_path];
        feats.push(audio::extract_features_for_window(
            audio,
            it.onset_ms,
            window_ms,
        ));
    }
    Ok(feats)
}

/// Extract MFCC (mean, std) stats for every item (same per-WAV cache pattern
/// as `extract_all_features`). Aligned by index with `items`.
#[allow(clippy::type_complexity)]
fn extract_all_mfccs(
    items: &[Item],
    window_ms: f64,
) -> Result<Vec<(Vec<f32>, Vec<f32>)>, String> {
    let mut cache: HashMap<PathBuf, AudioData> = HashMap::new();
    let mut mfccs = Vec::with_capacity(items.len());

    for it in items {
        if !cache.contains_key(&it.wav_path) {
            let bytes = std::fs::read(&it.wav_path)
                .map_err(|e| format!("cannot read {}: {e}", it.wav_path.display()))?;
            let audio = audio::ingest_wav(&bytes)
                .map_err(|e| format!("cannot decode {}: {e}", it.wav_path.display()))?;
            cache.insert(it.wav_path.clone(), audio);
        }
        let audio = &cache[&it.wav_path];
        let start_sample = ((it.onset_ms / 1000.0) * audio.sample_rate as f64) as usize;
        let dur_samples = ((window_ms / 1000.0) * audio.sample_rate as f64) as usize;
        let mono = audio.to_mono();
        let end_sample = (start_sample + dur_samples).min(mono.len());
        if start_sample >= mono.len() || start_sample >= end_sample {
            let n = beatrice_lib::audio::MFCC_COEFFS;
            mfccs.push((vec![0.0; n], vec![0.0; n]));
            continue;
        }
        mfccs.push(audio::extract_mfcc_stats(
            &mono[start_sample..end_sample],
            audio.sample_rate,
            beatrice_lib::audio::MFCC_COEFFS,
        ));
    }
    Ok(mfccs)
}

// ---------------------------------------------------------------------------
// Report assembly.
// ---------------------------------------------------------------------------

struct PassResult {
    /// (correct, total) per participant, in participant order.
    per_participant: Vec<(usize, usize)>,
    confusion: Confusion,
    /// Total utterances scored.
    scored: usize,
}

/// Group items by participant, preserving first-seen order.
fn group_by_participant(items: &[Item]) -> Vec<(String, Vec<usize>)> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, it) in items.iter().enumerate() {
        groups
            .entry(it.participant.clone())
            .or_insert_with(|| {
                order.push(it.participant.clone());
                Vec::new()
            })
            .push(i);
    }
    order
        .into_iter()
        .map(|p| {
            let idx = groups.remove(&p).unwrap_or_default();
            (p, idx)
        })
        .collect()
}

/// Run the Gaussian/hybrid passes with leave-one-participant-out (LOPO) rigor:
/// for each participant, fit a factory model on the other 27 participants'
/// items, then score that participant's eval set twice — user-agnostic, and
/// MAP-adapted from the participant's own calibration samples. LOPO is the
/// honest protocol for a fitted model: the scored participant's voice never
/// appears in their own factory model. Scoring goes through
/// [`HybridClassifier`] (Gaussian + sustained-signal hum gate), i.e. the exact
/// construction the app ships — a gated event that the heuristic calls
/// HumVoiced scores as wrong here, since AVP has no hum truth.
fn run_gaussian_passes(
    items: &[Item],
    feats: &[EventFeatures],
    mfccs: &[Vec<f32>],
    gfeats: &[Vec<f32>],
    calib_per_class: usize,
) -> (PassResult, PassResult) {
    let mut agnostic = PassResult {
        per_participant: Vec::new(),
        confusion: Confusion::new(),
        scored: 0,
    };
    let mut adapted = PassResult {
        per_participant: Vec::new(),
        confusion: Confusion::new(),
        scored: 0,
    };

    for (participant, indices) in group_by_participant(items) {
        // Factory model: everyone EXCEPT this participant.
        let train: Vec<(EventClass, Vec<f32>)> = items
            .iter()
            .zip(gfeats.iter())
            .filter(|(it, _)| it.participant != participant)
            .map(|(it, v)| (it.label, v.clone()))
            .collect();
        let Some(model) = GaussianModel::fit(&train) else {
            continue;
        };

        // This participant's calib/eval split (same split as the other passes).
        let participant_items: Vec<Item> = indices.iter().map(|&i| items[i].clone()).collect();
        let (calib_idx_local, eval_idx_local) =
            participant_split_indices(&participant_items, calib_per_class);
        let calib_global: Vec<usize> = calib_idx_local.iter().map(|&li| indices[li]).collect();
        let eval_global: Vec<usize> = eval_idx_local.iter().map(|&li| indices[li]).collect();

        let calib_samples: Vec<(EventClass, Vec<f32>)> = calib_global
            .iter()
            .map(|&g| (items[g].label, gfeats[g].clone()))
            .collect();
        let agn_clf = HybridClassifier::with_model(model.clone());
        let ada_clf =
            HybridClassifier::with_model(model.map_adapt(&calib_samples, DEFAULT_MAP_TAU));

        let mut agn_correct = 0usize;
        let mut ada_correct = 0usize;
        for &g in &eval_global {
            let truth = items[g].label;
            let apred = agn_clf.classify(&feats[g], &mfccs[g]).class;
            *agnostic.confusion.entry((truth, apred)).or_insert(0) += 1;
            if apred == truth {
                agn_correct += 1;
            }
            agnostic.scored += 1;

            let upred = ada_clf.classify(&feats[g], &mfccs[g]).class;
            *adapted.confusion.entry((truth, upred)).or_insert(0) += 1;
            if upred == truth {
                ada_correct += 1;
            }
            adapted.scored += 1;
        }
        if !eval_global.is_empty() {
            agnostic
                .per_participant
                .push((agn_correct, eval_global.len()));
            adapted
                .per_participant
                .push((ada_correct, eval_global.len()));
        }
    }

    (agnostic, adapted)
}

/// Run both passes. Both are scored on the same held-out eval set.
fn run_passes(
    items: &[Item],
    feats: &[EventFeatures],
    calib_per_class: usize,
) -> (PassResult, PassResult, usize) {
    let heuristic = HeuristicClassifier::new();
    let mut heur = PassResult {
        per_participant: Vec::new(),
        confusion: Confusion::new(),
        scored: 0,
    };
    let mut calib = PassResult {
        per_participant: Vec::new(),
        confusion: Confusion::new(),
        scored: 0,
    };
    let mut open_hat_eval = 0usize;

    for (_participant, indices) in group_by_participant(items) {
        // Split this participant's items into calib/eval by class.
        let participant_items: Vec<Item> = indices.iter().map(|&i| items[i].clone()).collect();
        let (calib_idx_local, eval_idx_local) =
            participant_split_indices(&participant_items, calib_per_class);
        // Map local indices back to global.
        let eval_global: Vec<usize> = eval_idx_local.iter().map(|&li| indices[li]).collect();
        let calib_global: Vec<usize> = calib_idx_local.iter().map(|&li| indices[li]).collect();

        // Build this participant's calibration profile from calib items.
        let mut profile = CalibrationProfile::new(format!("avp-{}", items[indices[0]].participant));
        for &g in &calib_global {
            profile.add_sample(CalibrationSample::new(items[g].label, feats[g].clone(), Vec::new(), 44100));
        }
        let knn = KnnClassifier::new(profile.clone(), KNN_K);
        let has_calib = profile.total_samples() > 0;

        let mut heur_correct = 0usize;
        let mut calib_correct = 0usize;

        for &g in &eval_global {
            let truth = items[g].label;
            if items[g].avp_raw == "hho" {
                open_hat_eval += 1;
            }

            // Heuristic pass.
            let hpred = heuristic.classify(&feats[g]).class;
            *heur.confusion.entry((truth, hpred)).or_insert(0) += 1;
            if hpred == truth {
                heur_correct += 1;
            }
            heur.scored += 1;

            // Calibrated pass (falls back to heuristic if this participant has
            // no calibration samples at all — should not happen with real data).
            let cpred = if has_calib {
                knn.classify(&feats[g]).map(|(c, _)| c).unwrap_or(hpred)
            } else {
                hpred
            };
            *calib.confusion.entry((truth, cpred)).or_insert(0) += 1;
            if cpred == truth {
                calib_correct += 1;
            }
            calib.scored += 1;
        }

        let eval_total = eval_global.len();
        if eval_total > 0 {
            heur.per_participant.push((heur_correct, eval_total));
            calib.per_participant.push((calib_correct, eval_total));
        }
    }

    (heur, calib, open_hat_eval)
}

#[allow(clippy::too_many_arguments)]
fn build_report(
    dataset: &Path,
    items: &[Item],
    skipped_unknown: usize,
    open_hat_eval: usize,
    calib_per_class: usize,
    window_ms: f64,
    heur: &PassResult,
    calib: &PassResult,
    gauss_agn: &PassResult,
    gauss_ada: &PassResult,
) -> String {
    let participants = group_by_participant(items).len();
    let heur_overall = mean_participant_accuracy(&heur.per_participant) * 100.0;
    let calib_overall = mean_participant_accuracy(&calib.per_participant) * 100.0;
    let gauss_agn_overall = mean_participant_accuracy(&gauss_agn.per_participant) * 100.0;
    let gauss_ada_overall = mean_participant_accuracy(&gauss_ada.per_participant) * 100.0;

    let mut out = String::new();
    out.push_str("# AVP Benchmark Results\n\n");
    out.push_str(&format!(
        "Dataset: `{}`\n\n",
        dataset.display()
    ));
    out.push_str(&format!(
        "- Participants: **{participants}**\n\
         - Annotated utterances: **{}**\n\
         - Utterances scored (held-out eval set): **{}**\n\
         - Calibration per class per participant: **{calib_per_class}**\n\
         - Feature window: **{window_ms:.0} ms**\n\
         - Unknown-label rows skipped: **{skipped_unknown}**\n\
         - Open-hat (`hho`) utterances in eval, folded into HihatNoise: **{open_hat_eval}**\n\n",
        items.len(),
        heur.scored,
    ));

    out.push_str("## Overall (participant-wise mean accuracy)\n\n");
    out.push_str("| Classifier | Accuracy |\n|---|---|\n");
    out.push_str(&format!("| Heuristic (no calibration) | {heur_overall:.1}% |\n"));
    out.push_str(&format!(
        "| Per-participant calibrated (kNN, k={KNN_K}) | {calib_overall:.1}% |\n"
    ));
    out.push_str(&format!(
        "| Gaussian MFCC model, user-agnostic (LOPO) | {gauss_agn_overall:.1}% |\n"
    ));
    out.push_str(&format!(
        "| Gaussian MFCC model + MAP calibration (LOPO, tau={DEFAULT_MAP_TAU:.0}) | **{gauss_ada_overall:.1}%** |\n\n"
    ));

    out.push_str("## Per-class precision / recall\n\n");
    out.push_str(
        "| Class | Heuristic P | Heuristic R | kNN P | kNN R | Gaussian P | Gaussian R |\n",
    );
    out.push_str("|---|---|---|---|---|---|---|\n");
    let fmt = |v: Option<f64>| match v {
        Some(x) => format!("{:.1}%", x * 100.0),
        None => "—".to_string(),
    };
    for &c in &CLASSES {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            class_label(c),
            fmt(precision(&heur.confusion, c)),
            fmt(recall(&heur.confusion, c)),
            fmt(precision(&calib.confusion, c)),
            fmt(recall(&calib.confusion, c)),
            fmt(precision(&gauss_ada.confusion, c)),
            fmt(recall(&gauss_ada.confusion, c)),
        ));
    }
    out.push('\n');

    out.push_str(
        "## Protocol\n\n\
         Participant-wise accuracy (Delgado et al.): the mean over participants of each \
         participant's per-utterance accuracy. All classifiers are scored on the same \
         held-out eval set — every utterance after the first N per class per participant. \
         Calibration examples come from the same participant but are excluded from that \
         participant's eval set. The Gaussian rows are leave-one-participant-out: each \
         participant is scored by a model fitted only on the other 27 participants \
         (their own voice never trains their factory model), then MAP-adapted from their \
         calibration samples. Open hi-hat (`hho`) has no Beatrice class and is folded \
         into HihatNoise (counted above).\n\n\
         Dataset: AVP \"Amateur Vocal Percussion\" (Delgado et al.), Zenodo, CC-BY.\n",
    );

    out
}

// ---------------------------------------------------------------------------
// Arg parsing + entry point.
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct Args {
    dataset: PathBuf,
    out: PathBuf,
    calib_per_class: usize,
    window_ms: f64,
    dump_features: Option<PathBuf>,
    fit_model: Option<PathBuf>,
}

/// Parse CLI args. Returns `Ok(None)` when `--help` was requested.
fn parse_args(argv: &[String]) -> Result<Option<Args>, String> {
    let mut dataset: Option<PathBuf> = None;
    let mut out = PathBuf::from("avp-results.md");
    let mut calib_per_class = DEFAULT_CALIB_PER_CLASS;
    let mut window_ms = FEATURE_WINDOW_MS;
    let mut dump_features: Option<PathBuf> = None;
    let mut fit_model: Option<PathBuf> = None;

    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "-h" | "--help" => return Ok(None),
            "--dataset" => {
                i += 1;
                let v = argv.get(i).ok_or("--dataset requires a path argument")?;
                dataset = Some(PathBuf::from(v));
            }
            "--out" => {
                i += 1;
                let v = argv.get(i).ok_or("--out requires a path argument")?;
                out = PathBuf::from(v);
            }
            "--calib-per-class" => {
                i += 1;
                let v = argv.get(i).ok_or("--calib-per-class requires a number")?;
                calib_per_class = v
                    .parse()
                    .map_err(|_| format!("invalid --calib-per-class value: {v}"))?;
            }
            "--window-ms" => {
                i += 1;
                let v = argv.get(i).ok_or("--window-ms requires a number")?;
                window_ms = v
                    .parse()
                    .map_err(|_| format!("invalid --window-ms value: {v}"))?;
            }
            "--dump-features" => {
                i += 1;
                let v = argv.get(i).ok_or("--dump-features requires a path argument")?;
                dump_features = Some(PathBuf::from(v));
            }
            "--fit-model" => {
                i += 1;
                let v = argv.get(i).ok_or("--fit-model requires a path argument")?;
                fit_model = Some(PathBuf::from(v));
            }
            other => return Err(format!("unknown argument: {other}\n\nRun with --help.")),
        }
        i += 1;
    }

    let dataset = dataset.ok_or(
        "missing required --dataset <DIR>.\n\nRun `benchmark --help` for the expected layout.",
    )?;

    Ok(Some(Args {
        dataset,
        out,
        calib_per_class,
        window_ms,
        dump_features,
        fit_model,
    }))
}

fn run() -> Result<(), String> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = match parse_args(&argv)? {
        Some(a) => a,
        None => {
            print!("{HELP}");
            return Ok(());
        }
    };

    println!("Scanning dataset at {} ...", args.dataset.display());
    let (items, skipped_unknown) = scan_dataset(&args.dataset)?;
    let participants = group_by_participant(&items).len();
    println!(
        "Found {} utterances across {} participant(s) ({} unknown-label rows skipped).",
        items.len(),
        participants,
        skipped_unknown
    );

    println!("Extracting features ({}ms window) ...", args.window_ms as i64);
    let feats = extract_all_features(&items, args.window_ms)?;
    println!("Extracting MFCCs ...");
    let mfccs = extract_all_mfccs(&items, args.window_ms)?;
    let gfeats: Vec<Vec<f32>> = feats
        .iter()
        .zip(mfccs.iter())
        .map(|(f, (mean, _std))| gaussian_features(f, mean))
        .collect();

    if let Some(dump_path) = &args.dump_features {
        println!("Extracting rich MFCC variants for the feature dump ...");
        let heuristic = HeuristicClassifier::new();
        let n20 = 20usize;
        let n13 = beatrice_lib::audio::MFCC_COEFFS;
        let m20_header: Vec<String> = (1..=n20).map(|i| format!("m20_{i}")).collect();
        let s20_header: Vec<String> = (1..=n20).map(|i| format!("s20_{i}")).collect();
        let h1_header: Vec<String> = (1..=n13).map(|i| format!("h1_{i}")).collect();
        let h2_header: Vec<String> = (1..=n13).map(|i| format!("h2_{i}")).collect();
        let mut csv_out = format!(
            "participant,avp_raw,truth,pred,centroid,zcr,low,mid,high,peak,crest,{},{},{},{}\n",
            m20_header.join(","),
            s20_header.join(","),
            h1_header.join(","),
            h2_header.join(",")
        );
        let mut cache: HashMap<PathBuf, AudioData> = HashMap::new();
        for (it, f) in items.iter().zip(feats.iter()) {
            if !cache.contains_key(&it.wav_path) {
                let bytes = std::fs::read(&it.wav_path)
                    .map_err(|e| format!("cannot read {}: {e}", it.wav_path.display()))?;
                let audio = audio::ingest_wav(&bytes)
                    .map_err(|e| format!("cannot decode {}: {e}", it.wav_path.display()))?;
                cache.insert(it.wav_path.clone(), audio);
            }
            let audio = &cache[&it.wav_path];
            let start = ((it.onset_ms / 1000.0) * audio.sample_rate as f64) as usize;
            let dur = ((args.window_ms / 1000.0) * audio.sample_rate as f64) as usize;
            let mono = audio.to_mono();
            let end = (start + dur).min(mono.len());
            let seg: &[f32] = if start < mono.len() && start < end {
                &mono[start..end]
            } else {
                &[]
            };
            let (m20, s20) = audio::extract_mfcc_stats(seg, audio.sample_rate, n20);
            let mid = seg.len() / 2;
            let h1 = audio::extract_mfcc(&seg[..mid.min(seg.len())], audio.sample_rate);
            let h2 = audio::extract_mfcc(&seg[mid.min(seg.len())..], audio.sample_rate);
            let join = |v: &[f32]| {
                v.iter()
                    .map(|c| c.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            };
            let pred = heuristic.classify(f).class;
            csv_out.push_str(&format!(
                "{},{},{:?},{:?},{},{},{},{},{},{},{},{},{},{},{}\n",
                it.participant,
                it.avp_raw,
                it.label,
                pred,
                f.spectral_centroid,
                f.zcr,
                f.low_band_energy,
                f.mid_band_energy,
                f.high_band_energy,
                f.peak_amplitude,
                f.crest_factor,
                join(&m20),
                join(&s20),
                join(&h1),
                join(&h2),
            ));
        }
        std::fs::write(dump_path, csv_out)
            .map_err(|e| format!("cannot write features to {}: {e}", dump_path.display()))?;
        println!("Dumped per-item features to {}", dump_path.display());
    }

    println!("Running heuristic + calibrated passes ...");
    let (heur, calib, open_hat_eval) = run_passes(&items, &feats, args.calib_per_class);

    println!("Running Gaussian LOPO passes (28 fits) ...");
    let mfcc_means: Vec<Vec<f32>> = mfccs.iter().map(|(mean, _)| mean.clone()).collect();
    let (gauss_agn, gauss_ada) =
        run_gaussian_passes(&items, &feats, &mfcc_means, &gfeats, args.calib_per_class);

    if let Some(model_path) = &args.fit_model {
        // The shipping artifact: fitted on ALL participants (LOPO above is the
        // honest accuracy estimate for exactly this construction).
        let train: Vec<(EventClass, Vec<f32>)> = items
            .iter()
            .zip(gfeats.iter())
            .map(|(it, v)| (it.label, v.clone()))
            .collect();
        let model = GaussianModel::fit(&train)
            .ok_or("cannot fit factory model: empty or inconsistent training data")?;
        let json = model
            .to_json()
            .map_err(|e| format!("cannot serialize factory model: {e}"))?;
        std::fs::write(model_path, &json)
            .map_err(|e| format!("cannot write model to {}: {e}", model_path.display()))?;
        println!(
            "Wrote factory Gaussian model ({} classes, {} dims, {} bytes) to {}",
            model.classes.len(),
            model.z_mean.len(),
            json.len(),
            model_path.display()
        );
    }

    let report = build_report(
        &args.dataset,
        &items,
        skipped_unknown,
        open_hat_eval,
        args.calib_per_class,
        args.window_ms,
        &heur,
        &calib,
        &gauss_agn,
        &gauss_ada,
    );

    // Print the tables to stdout (skip the leading "# AVP Benchmark Results").
    println!("\n{report}");

    std::fs::write(&args.out, &report)
        .map_err(|e| format!("cannot write report to {}: {e}", args.out.display()))?;
    println!("Wrote markdown report to {}", args.out.display());

    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn item(participant: &str) -> Item {
        Item {
            participant: participant.to_string(),
            wav_path: PathBuf::from("x.wav"),
            onset_ms: 0.0,
            label: EventClass::BilabialPlosive,
            avp_raw: "kd".to_string(),
        }
    }

    fn item_class(participant: &str, label: EventClass) -> Item {
        Item {
            participant: participant.to_string(),
            wav_path: PathBuf::from("x.wav"),
            onset_ms: 0.0,
            label,
            avp_raw: "kd".to_string(),
        }
    }

    #[test]
    fn avp_class_mapping() {
        assert_eq!(map_avp_class("kd"), Some(EventClass::BilabialPlosive));
        assert_eq!(map_avp_class("sd"), Some(EventClass::Click));
        assert_eq!(map_avp_class("hhc"), Some(EventClass::HihatNoise));
        assert_eq!(map_avp_class("hho"), Some(EventClass::HihatNoise));
        assert_eq!(map_avp_class("xx"), None);
    }

    #[test]
    fn avp_class_mapping_is_case_and_space_insensitive() {
        assert_eq!(map_avp_class(" KD "), Some(EventClass::BilabialPlosive));
        assert_eq!(map_avp_class("HHO"), Some(EventClass::HihatNoise));
    }

    #[test]
    fn participant_split_never_mixes() {
        let items = vec![item("p01"), item("p01"), item("p02"), item("p03")];
        let (calib, eval) = participant_split(&items, 5); // first 5 per participant → calibration
        for p in ["p01", "p02", "p03"] {
            assert!(
                calib
                    .iter()
                    .chain(eval.iter())
                    .filter(|i| i.participant == p)
                    .count()
                    > 0
            );
        }
        // eval items are never in calib
        assert!(eval
            .iter()
            .all(|e| !calib.iter().any(|c| std::ptr::eq(*c, *e))));
    }

    #[test]
    fn participant_split_holds_out_the_rest() {
        // p01 has 7 kd utterances; with n=5, first 5 → calib, last 2 → eval.
        let mut items = Vec::new();
        for _ in 0..7 {
            items.push(item_class("p01", EventClass::BilabialPlosive));
        }
        let (calib, eval) = participant_split(&items, 5);
        assert_eq!(calib.len(), 5);
        assert_eq!(eval.len(), 2);
        // Split is per-class: a second class gets its own quota.
        let mut mixed = items;
        for _ in 0..3 {
            mixed.push(item_class("p01", EventClass::Click));
        }
        let (calib2, eval2) = participant_split(&mixed, 5);
        // 5 kd + 3 sd (all sd < 5) → calib; 2 kd → eval.
        assert_eq!(calib2.len(), 8);
        assert_eq!(eval2.len(), 2);
    }

    #[test]
    fn parse_annotation_rows_basic() {
        let csv = "0.5,kd\n1.25,hhc\n2.0,sd\n";
        let rows = parse_annotation_rows(Cursor::new(csv));
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], (0.5, "kd".to_string()));
        assert_eq!(rows[1], (1.25, "hhc".to_string()));
        assert_eq!(rows[2], (2.0, "sd".to_string()));
    }

    #[test]
    fn parse_annotation_rows_skips_header_and_junk() {
        // A header row (non-numeric onset) and a short row must be skipped.
        let csv = "onset,label\n0.5,kd\nbadrow\n1.0,hho\n";
        let rows = parse_annotation_rows(Cursor::new(csv));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (0.5, "kd".to_string()));
        assert_eq!(rows[1], (1.0, "hho".to_string()));
    }

    #[test]
    fn rows_to_items_maps_and_drops_unknown() {
        let rows = vec![
            (0.5, "kd".to_string()),
            (1.0, "zz".to_string()), // unknown → skipped
            (1.5, "hho".to_string()),
        ];
        let (items, skipped) = rows_to_items(&rows, "p01", Path::new("rec.wav"));
        assert_eq!(skipped, 1);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].label, EventClass::BilabialPlosive);
        assert_eq!(items[0].onset_ms, 500.0); // seconds → ms
        assert_eq!(items[1].label, EventClass::HihatNoise);
        assert_eq!(items[1].avp_raw, "hho");
        assert_eq!(items[0].participant, "p01");
    }

    #[test]
    fn mean_participant_accuracy_averages_over_participants() {
        // Participant-wise mean must weight each participant equally regardless
        // of utterance count: (100% + 0%) / 2 = 50%, NOT pooled (1/3).
        let stats = vec![(2usize, 2usize), (0usize, 1usize)];
        let acc = mean_participant_accuracy(&stats);
        assert!((acc - 0.5).abs() < 1e-9);
    }

    #[test]
    fn mean_participant_accuracy_ignores_empty_participants() {
        let stats = vec![(1usize, 2usize), (0usize, 0usize)];
        let acc = mean_participant_accuracy(&stats);
        assert!((acc - 0.5).abs() < 1e-9); // second participant ignored
    }

    #[test]
    fn precision_and_recall_from_confusion() {
        let mut conf: Confusion = HashMap::new();
        // Truth kd: 3 predicted kd (tp), 1 predicted sd (miss).
        conf.insert((EventClass::BilabialPlosive, EventClass::BilabialPlosive), 3);
        conf.insert((EventClass::BilabialPlosive, EventClass::Click), 1);
        // Truth sd: 1 predicted kd (false positive for kd).
        conf.insert((EventClass::Click, EventClass::BilabialPlosive), 1);

        // recall(kd) = 3 / (3+1) = 0.75
        assert!((recall(&conf, EventClass::BilabialPlosive).unwrap() - 0.75).abs() < 1e-9);
        // precision(kd) = 3 / (3 predicted-kd-from-kd + 1 predicted-kd-from-sd) = 0.75
        assert!((precision(&conf, EventClass::BilabialPlosive).unwrap() - 0.75).abs() < 1e-9);
        // No HumVoiced truth or predictions → None.
        assert!(recall(&conf, EventClass::HumVoiced).is_none());
        assert!(precision(&conf, EventClass::HumVoiced).is_none());
    }

    #[test]
    fn parse_args_requires_dataset() {
        let err = parse_args(&["--out".to_string(), "x.md".to_string()]).unwrap_err();
        assert!(err.contains("--dataset"));
    }

    #[test]
    fn parse_args_help_returns_none() {
        let parsed = parse_args(&["--help".to_string()]).unwrap();
        assert!(parsed.is_none());
    }

    #[test]
    fn parse_args_reads_all_options() {
        let argv = vec![
            "--dataset".to_string(),
            "/data/AVP".to_string(),
            "--out".to_string(),
            "r.md".to_string(),
            "--calib-per-class".to_string(),
            "3".to_string(),
            "--window-ms".to_string(),
            "200".to_string(),
        ];
        let args = parse_args(&argv).unwrap().unwrap();
        assert_eq!(args.dataset, PathBuf::from("/data/AVP"));
        assert_eq!(args.out, PathBuf::from("r.md"));
        assert_eq!(args.calib_per_class, 3);
        assert!((args.window_ms - 200.0).abs() < 1e-9);
    }

    #[test]
    fn scan_dataset_missing_path_fails_gracefully() {
        let err = scan_dataset(Path::new("/nonexistent/avp/path/xyz")).unwrap_err();
        assert!(err.contains("does not exist"));
    }
}
