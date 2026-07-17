"""Nested out-of-fold (OOF) evaluation scaffolding — pure local library.

This module wires the cosine-prototype few-shot pipeline (prototypes.py) into
the locked AVP-LVT splits and provides a Python reimplementation of the
shipping hybrid Gaussian recipe as a matched baseline. It performs NO EC2/AWS
work: it trains encoders locally (via train.train_encoder) and evaluates with
the deterministic draw scheme from prototypes.five_shot_eval.

LOCKED TEST SET
---------------
The eight ``test_participants`` in the splits JSON are held out completely: no
model inference, no metrics, no error inspection. Every train/eval entry point
asserts that none of the participants it touches are in that set.

nested_oof_run
--------------
For each outer fold F (F1..F5):
  * the other four folds form the dev pool;
  * the inner split rotates deterministically — the *next* fold after F (wrapping
    F5 -> F1) becomes the encoder-val fold, the remaining three the encoder-train
    folds;
  * an encoder is trained on encoder-train (val = encoder-val);
  * factory prototypes are built from the encoder-train participants' embeddings;
  * tau is selected on the inner (encoder-val) fold's 5-shot macro accuracy,
    swept over ``config["prototypes"]["tau_grid"]``;
  * the outer fold's participants are evaluated at 0-shot (factory prototypes,
    tau irrelevant), 5-shot (selected tau), and full-support (all isolated
    events as support, selected tau).
Per-participant macro accuracy averages over the classes present in that
participant's improvisation queries (three LVT participants lack one class).
Results are aggregated over all 40 dev participants plus AVP-only / LVT-only
breakdowns.

matched_gaussian_baseline
--------------------------
A Python REIMPLEMENTATION (not the Rust binary) of the shipping hybrid Gaussian
recipe: a diagonal Gaussian (QDA) over [20 MFCCs, zcr, crest] with MAP mean
adaptation at tau=10, evaluated with the identical fold structure and draw
scheme. It is validated against real data in Task 11.
"""
from __future__ import annotations

import json
import math
import tempfile
from pathlib import Path

import numpy as np

from . import frontend
from .patches import load_recording_24k
from .prototypes import factory_prototypes, five_shot_eval, select_tau
from .train import embed_all, train_encoder

CLASSES = ("kick", "snare", "hihat")


# --------------------------------------------------------------------------- #
# Locked test-set enforcement
# --------------------------------------------------------------------------- #
def _load_splits(splits) -> dict:
    if isinstance(splits, (str, Path)):
        return json.loads(Path(splits).read_text())
    return splits


def _test_participants(splits) -> set:
    return set(_load_splits(splits)["test_participants"])


def _assert_not_test(participants, test: set) -> None:
    """Guard: refuse to touch any locked TEST participant."""
    for p in participants:
        assert p not in test, f"LOCKED test participant may not be used: {p!r}"


def _dataset_of(pid: str) -> str:
    """Namespace of a participant id, e.g. 'avp:6' -> 'avp'."""
    return str(pid).split(":", 1)[0]


# --------------------------------------------------------------------------- #
# Inner/outer fold bookkeeping
# --------------------------------------------------------------------------- #
def _fold_order(dev_outer_folds: dict) -> list:
    """Deterministic fold order (F1, F2, ... by natural sort of the keys)."""
    return sorted(dev_outer_folds, key=lambda k: (len(k), k))


def _inner_split(fold_names: list, outer: str) -> tuple:
    """Given the ordered fold names and the current outer fold, return
    ``(encoder_train_folds, encoder_val_fold)``. The encoder-val fold is the
    next fold after the outer one (wrapping around), among the dev pool."""
    i = fold_names.index(outer)
    val = fold_names[(i + 1) % len(fold_names)]
    train = [f for f in fold_names if f not in (outer, val)]
    return train, val


def _to_five_shot_meta(meta: dict) -> dict:
    """Adapt embed_all's meta (instrument3/participant/role) to the generic
    key names five_shot_eval expects (labels/participants/roles/instrument4)."""
    return dict(
        labels=meta["instrument3"],
        participants=meta["participant"],
        roles=meta["role"],
        instrument4=meta["instrument4"],
    )


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #
def _macro(result: dict) -> float:
    return float(result["macro_accuracy"])


def _aggregate(per_participant: dict, shot_modes) -> dict:
    """Aggregate per-participant macro accuracy into overall / AVP / LVT means
    for each shot mode."""
    agg = {}
    for mode in shot_modes:
        vals_all, vals_avp, vals_lvt = [], [], []
        for pid, res in per_participant.items():
            m = res[mode]
            vals_all.append(m)
            (vals_avp if _dataset_of(pid) == "avp" else vals_lvt).append(m)
        agg[mode] = {
            "all": float(np.mean(vals_all)) if vals_all else 0.0,
            "avp": float(np.mean(vals_avp)) if vals_avp else 0.0,
            "lvt": float(np.mean(vals_lvt)) if vals_lvt else 0.0,
            "n_all": len(vals_all),
            "n_avp": len(vals_avp),
            "n_lvt": len(vals_lvt),
        }
    return agg


# --------------------------------------------------------------------------- #
# CNN cosine-prototype nested OOF
# --------------------------------------------------------------------------- #
def nested_oof_run(config: dict, cache, splits, seed: int, mode: str = "cnn") -> dict:
    """Run the full nested-OOF cosine-prototype evaluation (see module docstring).

    ``config`` is the parsed YAML dict, ``cache`` the npz patch-cache path,
    ``splits`` the splits JSON (path or dict), ``seed`` the RNG seed. ``mode`` is
    a label carried into the result (default ``"cnn"``); it selects the CNN
    encoder path and is recorded for downstream reporting.

    Returns a dict of plain Python floats:
    ``{"mode", "seed", "tau_grid", "selected_tau", "per_participant",
    "aggregate"}``.
    """
    splits = _load_splits(splits)
    test = set(splits["test_participants"])
    dev_outer_folds = splits["dev_outer_folds"]
    fold_names = _fold_order(dev_outer_folds)

    proto_cfg = config.get("prototypes", {})
    tau_grid = list(proto_cfg.get("tau_grid", [0, 1, 2, 5, 10, 20]))
    support_k = int(proto_cfg.get("support_k", 5))
    eval_draws = int(proto_cfg.get("eval_draws", 100))

    shot_modes = ("0shot", "5shot", "full")
    per_participant: dict = {}
    selected_tau: dict = {}

    for outer in fold_names:
        outer_participants = dev_outer_folds[outer]
        train_folds, val_fold = _inner_split(fold_names, outer)
        encoder_train = [p for f in train_folds for p in dev_outer_folds[f]]
        encoder_val = list(dev_outer_folds[val_fold])

        # Locked-test guard on every participant group this fold touches.
        _assert_not_test(encoder_train, test)
        _assert_not_test(encoder_val, test)
        _assert_not_test(outer_participants, test)

        with tempfile.TemporaryDirectory(prefix=f"oof_{outer}_") as tmp:
            ckpt = train_encoder(cache, encoder_train, encoder_val, config,
                                 seed, tmp)

            # Factory prototypes from encoder-train embeddings.
            train_emb, train_meta = embed_all(ckpt, cache, encoder_train)
            protos = factory_prototypes(train_emb, train_meta["instrument3"],
                                        train_meta["participant"])

            # ---- tau selection on the inner (encoder-val) fold ----
            val_emb, val_meta = embed_all(ckpt, cache, encoder_val)
            val_fs_meta = _to_five_shot_meta(val_meta)
            tau_macros: dict = {tau: [] for tau in tau_grid}
            for pid in encoder_val:
                for tau in tau_grid:
                    r = five_shot_eval(val_emb, val_fs_meta, pid, protos,
                                       float(tau), k=support_k,
                                       draws=eval_draws, seed=seed,
                                       classes=CLASSES)
                    tau_macros[tau].append(_macro(r))
            tau = select_tau(tau_macros)
            selected_tau[outer] = tau

            # ---- evaluate the outer fold's participants ----
            out_emb, out_meta = embed_all(ckpt, cache, outer_participants)
            out_fs_meta = _to_five_shot_meta(out_meta)
            for pid in outer_participants:
                # 0-shot: no support (k=0) -> adapted proto == factory proto.
                r0 = five_shot_eval(out_emb, out_fs_meta, pid, protos, 1.0,
                                    k=0, draws=1, seed=seed, classes=CLASSES)
                # 5-shot: selected tau, k support events, averaged over draws.
                r5 = five_shot_eval(out_emb, out_fs_meta, pid, protos, tau,
                                    k=support_k, draws=eval_draws, seed=seed,
                                    classes=CLASSES)
                # Full-support: all isolated events (k huge -> min clamps),
                # deterministic so a single draw suffices.
                rf = five_shot_eval(out_emb, out_fs_meta, pid, protos, tau,
                                    k=10_000, draws=1, seed=seed, classes=CLASSES)
                per_participant[pid] = {
                    "0shot": _macro(r0),
                    "5shot": _macro(r5),
                    "full": _macro(rf),
                    "per_class_recall_5shot": r5["per_class_recall"],
                    "n_query_classes": len(r5["per_class_recall"]),
                }

    return {
        "mode": mode,
        "seed": seed,
        "tau_grid": tau_grid,
        "selected_tau": selected_tau,
        "per_participant": per_participant,
        "aggregate": _aggregate(per_participant, shot_modes),
    }


# --------------------------------------------------------------------------- #
# Matched Gaussian baseline (Python reimplementation of the shipping recipe)
# --------------------------------------------------------------------------- #
_N_MFCC = 20
_MAP_TAU = 10.0
_VAR_FLOOR = 1e-6


def _dct_ii_ortho(x: np.ndarray, n_out: int) -> np.ndarray:
    """Orthonormal DCT-II of a 1-D signal, keeping the first ``n_out`` coeffs.

    Matches scipy.fft.dct(x, type=2, norm='ortho')[:n_out].
    """
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[0]
    k = np.arange(n_out)[:, None]
    j = np.arange(n)[None, :]
    basis = np.cos(np.pi * (2 * j + 1) * k / (2 * n))
    coeffs = 2.0 * (basis @ x)
    scale = np.full(n_out, math.sqrt(1.0 / (2 * n)))
    scale[0] = math.sqrt(1.0 / (4 * n))
    return coeffs * scale


def gaussian_features(x24: np.ndarray, onset_s: float,
                      pre_s: float = 0.025, post_s: float = 0.125) -> np.ndarray:
    """[20 MFCCs, zcr, crest] feature vector for one event.

    * 20 MFCCs: DCT-II (orthonormal) of the 64-mel log energies averaged over
      STFT frames of the raw crop (same crop / STFT / mel filterbank as the
      frontend, but log energies rather than the normalized log-mel patch).
    * zcr: zero-crossing rate of the raw crop.
    * crest: crest factor max(|x|) / rms(x) of the raw crop.
    """
    crop = frontend.crop_samples(np.asarray(x24, dtype=np.float64),
                                 onset_s, pre_s, post_s)
    n_fft, hop = frontend.N_FFT, frontend.HOP
    win = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n_fft) / n_fft)
    fb = frontend.mel_filterbank()

    n_frames = (len(crop) - n_fft) // hop + 1
    if n_frames < 1:
        mfcc = np.zeros(_N_MFCC, dtype=np.float64)
    else:
        frames = np.stack([crop[i * hop:i * hop + n_fft] * win
                           for i in range(n_frames)])
        power = np.abs(np.fft.rfft(frames, axis=1)) ** 2         # (n_frames, 301)
        mel = power @ fb.T                                        # (n_frames, 64)
        log_mel = np.log(np.maximum(mel, 1e-12))
        mfcc = _dct_ii_ortho(log_mel.mean(axis=0), _N_MFCC)

    rms = float(np.sqrt(np.mean(crop ** 2))) if crop.size else 0.0
    peak = float(np.max(np.abs(crop))) if crop.size else 0.0
    crest = peak / rms if rms > 1e-12 else 0.0
    if crop.size > 1:
        zcr = float(np.mean(np.abs(np.diff(np.sign(crop))) > 0))
    else:
        zcr = 0.0

    return np.concatenate([mfcc, [zcr, crest]]).astype(np.float64)


def build_gaussian_bank(manifest_rows, roots, participants, config) -> tuple:
    """Build the [20 MFCC, zcr, crest] feature bank (originals only) for the
    given participants. Returns ``(feats (N, 22), meta dict of arrays)`` with
    meta keys ``labels`` / ``participants`` / ``roles`` / ``instrument4`` —
    already in five_shot_eval's key convention."""
    keep = set(participants)
    crop = config.get("frontend", {})
    pre_s = float(crop.get("crop_pre_s", 0.025))
    post_s = float(crop.get("crop_post_s", 0.125))

    feats, labels, parts, roles, inst4 = [], [], [], [], []
    for row in manifest_rows:
        if row["participant"] not in keep:
            continue
        x24 = load_recording_24k(roots, row["dataset"], row["path"])
        feats.append(gaussian_features(x24, float(row["onset_seconds"]),
                                       pre_s, post_s))
        labels.append(row["instrument3"])
        parts.append(row["participant"])
        roles.append(row["role"])
        inst4.append(row["instrument4"])

    feats = np.array(feats, dtype=np.float64) if feats else np.zeros((0, 22))
    meta = dict(labels=np.array(labels), participants=np.array(parts),
                roles=np.array(roles), instrument4=np.array(inst4))
    return feats, meta


def _fit_factory_gaussian(feats: np.ndarray, meta: dict, classes) -> dict:
    """Participant-balanced diagonal Gaussian per class.

    Prior mean μ0 = mean over participants of each participant's per-class
    feature mean. Prior variance σ0² = participant-balanced mean of per-class
    diagonal variance (floored). Returns ``{cls: (mu0, var0)}``.
    """
    labels = meta["labels"]
    parts = meta["participants"]
    model = {}
    for c in classes:
        cmask = labels == c
        if not np.any(cmask):
            continue
        cparts = sorted(set(parts[cmask].tolist()))
        means, varis = [], []
        for p in cparts:
            sel = cmask & (parts == p)
            fp = feats[sel]
            means.append(fp.mean(axis=0))
            varis.append(fp.var(axis=0) if fp.shape[0] > 1
                         else np.zeros(fp.shape[1]))
        mu0 = np.mean(np.stack(means), axis=0)
        var0 = np.maximum(np.mean(np.stack(varis), axis=0), _VAR_FLOOR)
        model[c] = (mu0, var0)
    return model


def _gaussian_loglik(x: np.ndarray, mu: np.ndarray, var: np.ndarray) -> float:
    """Diagonal-Gaussian log-likelihood (up to the shared -0.5*D*log(2π))."""
    return float(-0.5 * np.sum((x - mu) ** 2 / var + np.log(var)))


def _gaussian_shot_eval(feats, meta, target_participant, factory, tau,
                        k, draws, seed, classes) -> dict:
    """Gaussian analogue of five_shot_eval: MAP-adapt each class mean with the
    participant's isolated support, classify improvisation queries by
    diagonal-Gaussian log-likelihood. Same deterministic draw scheme."""
    labels = meta["labels"]
    parts = meta["participants"]
    roles = meta["roles"]

    pmask = parts == target_participant
    cand = [c for c in classes if c in factory]
    support_idx = {c: np.flatnonzero(pmask & (roles == "isolated") & (labels == c))
                   for c in cand}
    query_idx = np.flatnonzero(pmask & (roles == "improvisation"))
    q_feats = feats[query_idx]
    q_true = labels[query_idx]
    present = [c for c in cand if np.any(q_true == c)]

    if query_idx.size == 0 or not present:
        return {"per_class_recall": {}, "macro_accuracy": 0.0,
                "event_accuracy": 0.0}

    recall_accum = {c: 0.0 for c in present}
    macro_accum, event_accum = 0.0, 0.0

    for draw in range(draws):
        rng = np.random.default_rng([seed, draw])
        adapted = {}
        for c in cand:
            mu0, var0 = factory[c]
            pool = support_idx[c]
            kk = min(k, pool.size)
            if kk > 0:
                chosen = rng.choice(pool, size=kk, replace=False)
                s = feats[chosen].sum(axis=0)
                mu = (tau * mu0 + s) / (tau + kk)
            else:
                mu = mu0
            adapted[c] = (mu, var0)

        preds = []
        for x in q_feats:
            best_c, best_ll = None, -math.inf
            for c in cand:
                mu, var = adapted[c]
                ll = _gaussian_loglik(x, mu, var)
                if ll > best_ll:
                    best_ll, best_c = ll, c
            preds.append(best_c)
        preds = np.array(preds)

        per_class = {}
        for c in present:
            cm = q_true == c
            per_class[c] = float(np.mean(preds[cm] == c))
            recall_accum[c] += per_class[c]
        macro_accum += float(np.mean([per_class[c] for c in present]))
        event_accum += float(np.mean(preds == q_true))

    return {
        "per_class_recall": {c: recall_accum[c] / draws for c in present},
        "macro_accuracy": macro_accum / draws,
        "event_accuracy": event_accum / draws,
    }


def matched_gaussian_baseline(config: dict, manifest_rows, roots, splits,
                              seed: int) -> dict:
    """Matched hybrid-Gaussian baseline — a Python REIMPLEMENTATION of the
    shipping recipe (NOT the Rust binary), validated against real data in
    Task 11.

    Diagonal Gaussian (QDA) over [20 MFCCs, zcr, crest] with MAP mean adaptation
    at tau=10, evaluated on the identical outer folds and draw scheme as
    ``nested_oof_run``. The factory Gaussian for each outer fold is fit from the
    dev pool (the four non-outer folds); no encoder and no tau search are needed
    (tau is fixed at the recipe's MAP tau=10). Returns the same aggregate
    structure marked ``mode = "matched_gaussian"``.
    """
    splits = _load_splits(splits)
    test = set(splits["test_participants"])
    dev_outer_folds = splits["dev_outer_folds"]
    fold_names = _fold_order(dev_outer_folds)

    proto_cfg = config.get("prototypes", {})
    support_k = int(proto_cfg.get("support_k", 5))
    eval_draws = int(proto_cfg.get("eval_draws", 100))

    shot_modes = ("0shot", "5shot", "full")
    per_participant: dict = {}

    for outer in fold_names:
        outer_participants = dev_outer_folds[outer]
        dev_pool = [p for f in fold_names if f != outer
                    for p in dev_outer_folds[f]]
        _assert_not_test(dev_pool, test)
        _assert_not_test(outer_participants, test)

        factory_feats, factory_meta = build_gaussian_bank(
            manifest_rows, roots, dev_pool, config)
        factory = _fit_factory_gaussian(factory_feats, factory_meta, CLASSES)

        out_feats, out_meta = build_gaussian_bank(
            manifest_rows, roots, outer_participants, config)

        for pid in outer_participants:
            r0 = _gaussian_shot_eval(out_feats, out_meta, pid, factory,
                                     _MAP_TAU, 0, 1, seed, CLASSES)
            r5 = _gaussian_shot_eval(out_feats, out_meta, pid, factory,
                                     _MAP_TAU, support_k, eval_draws, seed,
                                     CLASSES)
            rf = _gaussian_shot_eval(out_feats, out_meta, pid, factory,
                                     _MAP_TAU, 10_000, 1, seed, CLASSES)
            per_participant[pid] = {
                "0shot": _macro(r0),
                "5shot": _macro(r5),
                "full": _macro(rf),
                "per_class_recall_5shot": r5["per_class_recall"],
                "n_query_classes": len(r5["per_class_recall"]),
            }

    return {
        "mode": "matched_gaussian",
        "seed": seed,
        "map_tau": _MAP_TAU,
        "per_participant": per_participant,
        "aggregate": _aggregate(per_participant, shot_modes),
    }


# --------------------------------------------------------------------------- #
# Efficacy-gate aggregation and paired participant bootstrap
# --------------------------------------------------------------------------- #
#
# Gate spec (§8): 3-seed (1729, 2718, 31415) mean 5-shot merged-3-way
# participant-macro accuracy over the pooled 40 dev participants:
#   * pooled 3-seed mean ......................... >= 0.900   (mean_ok)
#   * every individual seed's pooled 5-shot mean.. >= 0.880   (seeds_ok)
#   * every class's pooled 5-shot recall ......... >= 0.800   (classes_ok)
#   * paired participant bootstrap (10,000 resamples, seeded 1729) of the
#     CNN - matched_gaussian per-participant 5-shot macro deltas:
#     95% lower bound ............................ >  0        (bootstrap_ok)
# PASS = mean_ok AND seeds_ok AND classes_ok AND bootstrap_ok.
#
# 0-shot / full-support pooled means are reported as secondaries, and
# AVP-only / LVT-only 5-shot means as diagnostics (neither is gated).

_GATE_SEEDS = (1729, 2718, 31415)
_BOOTSTRAP_SEED = 1729

_THRESH_MEAN = 0.900
_THRESH_SEED = 0.880
_THRESH_CLASS_RECALL = 0.800


def paired_bootstrap_lower95(deltas, n_resamples: int = 10_000,
                             seed: int = _BOOTSTRAP_SEED) -> float:
    """Percentile bootstrap 95% lower bound of the mean of paired deltas.

    ``deltas`` is one paired value per participant (e.g. CNN minus
    matched-Gaussian 5-shot macro accuracy). Participants are resampled WITH
    replacement ``n_resamples`` times; the mean of each resample forms the
    bootstrap distribution, whose 2.5th percentile is returned. Deterministic
    given ``seed`` (uses ``np.random.default_rng(seed)``)."""
    deltas = np.asarray(deltas, dtype=np.float64).ravel()
    n = deltas.shape[0]
    if n == 0:
        raise ValueError("paired_bootstrap_lower95 needs at least one delta")
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_resamples, n))
    resample_means = deltas[idx].mean(axis=1)
    return float(np.percentile(resample_means, 2.5))


def _pooled_5shot_mean(runs_by_seed: dict) -> float:
    """3-seed mean of the pooled (all-participant) 5-shot participant-macro."""
    per_seed = [run["aggregate"]["5shot"]["all"] for run in runs_by_seed.values()]
    return float(np.mean(per_seed)) if per_seed else 0.0


def _per_seed_5shot(runs_by_seed: dict) -> dict:
    """{seed: pooled 5-shot participant-macro} for that seed's run."""
    return {int(s): float(run["aggregate"]["5shot"]["all"])
            for s, run in runs_by_seed.items()}


def _pooled_per_class_recall(runs_by_seed: dict) -> dict:
    """Pooled 5-shot per-class recall, averaged 3 ways.

    For each seed we take the mean over that seed's participants of each
    participant's per-class 5-shot recall (only participants whose queries
    contain the class contribute); those per-seed per-class means are then
    averaged across the seeds. Classes absent from every participant map to
    0.0 so they cannot silently pass the gate."""
    per_class_seed_means = {c: [] for c in CLASSES}
    for run in runs_by_seed.values():
        seed_class_vals = {c: [] for c in CLASSES}
        for res in run["per_participant"].values():
            for c, rec in res["per_class_recall_5shot"].items():
                seed_class_vals[c].append(float(rec))
        for c in CLASSES:
            vals = seed_class_vals[c]
            per_class_seed_means[c].append(float(np.mean(vals)) if vals else 0.0)
    return {c: (float(np.mean(v)) if v else 0.0)
            for c, v in per_class_seed_means.items()}


def _pooled_mode_mean(runs_by_seed: dict, mode: str, subset: str = "all") -> float:
    """3-seed mean of the pooled participant-macro for a shot mode / subset."""
    vals = [run["aggregate"][mode][subset] for run in runs_by_seed.values()]
    return float(np.mean(vals)) if vals else 0.0


def gate_report(runs_by_seed: dict, gaussian_by_seed: dict) -> dict:
    """Compute every efficacy-gate line from per-seed nested-OOF results.

    ``runs_by_seed`` maps seed -> ``nested_oof_run`` result (CNN, ``mode``
    typically ``"cnn"``); ``gaussian_by_seed`` maps seed -> the matched
    ``matched_gaussian_baseline`` result. Both share the per-seed shape
    ``{"aggregate": {mode: {"all"/"avp"/"lvt", ...}}, "per_participant":
    {pid: {"0shot"/"5shot"/"full", "per_class_recall_5shot": {cls: r}, ...}}}``.

    The bootstrap is run on the seed-1729 paired per-participant 5-shot deltas
    (CNN minus matched Gaussian) — a single, deterministic seed is chosen
    (rather than pooling all three) so the reported 95% lower bound is exactly
    reproducible and matches the spec's ``seeded 1729`` requirement.

    Returns a dict of plain Python floats/bools with a top-level ``PASS``."""
    pooled_mean_5shot = _pooled_5shot_mean(runs_by_seed)
    per_seed_5shot = _per_seed_5shot(runs_by_seed)
    per_class_recall = _pooled_per_class_recall(runs_by_seed)
    worst_class_recall = (min(per_class_recall.values())
                          if per_class_recall else 0.0)

    # Paired per-participant 5-shot deltas on the bootstrap seed.
    cnn_run = runs_by_seed[_BOOTSTRAP_SEED]
    gauss_run = gaussian_by_seed[_BOOTSTRAP_SEED]
    cnn_pp = cnn_run["per_participant"]
    gauss_pp = gauss_run["per_participant"]
    common = [pid for pid in cnn_pp if pid in gauss_pp]
    deltas = np.array([cnn_pp[pid]["5shot"] - gauss_pp[pid]["5shot"]
                       for pid in common], dtype=np.float64)
    bootstrap_lower95 = paired_bootstrap_lower95(deltas, seed=_BOOTSTRAP_SEED)

    secondaries = {
        "pooled_mean_0shot": _pooled_mode_mean(runs_by_seed, "0shot"),
        "pooled_mean_full": _pooled_mode_mean(runs_by_seed, "full"),
    }
    avp_only = {
        "0shot": _pooled_mode_mean(runs_by_seed, "0shot", "avp"),
        "5shot": _pooled_mode_mean(runs_by_seed, "5shot", "avp"),
        "full": _pooled_mode_mean(runs_by_seed, "full", "avp"),
    }
    lvt_only = {
        "0shot": _pooled_mode_mean(runs_by_seed, "0shot", "lvt"),
        "5shot": _pooled_mode_mean(runs_by_seed, "5shot", "lvt"),
        "full": _pooled_mode_mean(runs_by_seed, "full", "lvt"),
    }

    mean_ok = pooled_mean_5shot >= _THRESH_MEAN
    seeds_ok = bool(per_seed_5shot) and all(
        v >= _THRESH_SEED for v in per_seed_5shot.values())
    classes_ok = bool(per_class_recall) and all(
        v >= _THRESH_CLASS_RECALL for v in per_class_recall.values())
    bootstrap_ok = bootstrap_lower95 > 0.0
    verdicts = {
        "mean_ok": bool(mean_ok),
        "seeds_ok": bool(seeds_ok),
        "classes_ok": bool(classes_ok),
        "bootstrap_ok": bool(bootstrap_ok),
        "PASS": bool(mean_ok and seeds_ok and classes_ok and bootstrap_ok),
    }

    return {
        "seeds": [int(s) for s in runs_by_seed],
        "bootstrap_seed": _BOOTSTRAP_SEED,
        "n_bootstrap_participants": len(common),
        "thresholds": {
            "mean": _THRESH_MEAN,
            "seed": _THRESH_SEED,
            "class_recall": _THRESH_CLASS_RECALL,
        },
        "pooled_mean_5shot": pooled_mean_5shot,
        "per_seed_5shot": per_seed_5shot,
        "per_class_recall": per_class_recall,
        "worst_class_recall": worst_class_recall,
        "bootstrap_lower95": bootstrap_lower95,
        "secondaries": secondaries,
        "avp_only": avp_only,
        "lvt_only": lvt_only,
        "verdicts": verdicts,
    }
