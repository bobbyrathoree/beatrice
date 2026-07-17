"""Crop and frontend ablation driver — Stage-1 ablations (Task 9, local part).

One seed (1729). INNER FOLDS ONLY: variants are compared on inner-fold 5-shot
macro accuracy, and outer-fold participants are NEVER touched by any variant.

Protocol (identical across every variant)
------------------------------------------
For each outer fold F_i (F1..F5) we take a single inner setting, reusing the
deterministic inner split from ``evaluate._inner_split``:

  * ``encoder_val`` = the fold immediately after F_i (wrapping F5 -> F1);
  * ``encoder_train`` = the other three dev folds (F_i and encoder_val excluded);
  * the encoder is trained on encoder_train (val CE on encoder_val);
  * factory prototypes are built from encoder_train embeddings;
  * the encoder_val fold's participants are 5-shot evaluated (fixed tau, identical
    for every variant) — support drawn from each participant's isolated events,
    queries are their improvisation events.

The outer fold F_i's own participants are used in NEITHER training NOR evaluation
for that setting, so the ablation never touches outer-fold participants. The
LOCKED TEST participants are never touched either (same guard as evaluate.py, and
patch caches are built only for the dev participant restriction). We average the
five inner-setting macro accuracies (one per encoder_val fold).

Variants
--------
Crop comparison (mel64):
  A (pre=0.025, post=0.125) · B (0, 0.150) · C (0, 0.300, cap_next_onset) ·
  D (0, 0.560, cap_next_onset).
Frontend comparison at the A/B winner crop: mel64 (reuses the winning crop
variant's numbers) vs a freshly trained linear64 encoder.

Pre-registered decision rules (encoded in the JSON output)
----------------------------------------------------------
  * A -> B switch only if B - A >= +1.0 point (pp of macro accuracy).
  * linear64 adopted only if linear - mel >= +1.0 point AND no material hi-hat
    recall loss (linear hi-hat recall not more than 2.0 pp below mel).
  * if C or D beats the chosen 150 ms crop by >= 3.0 points -> flag
    ``ESCALATE_LATENCY`` (a human latency decision, per spec §9).

CLI
---
    uv run python -m beatrice_ml.ablate --config configs/avplvt_v1.yaml \
        [--dry-run --participants avp:1,avp:2,avp:3,lvt:Bea --epochs 2] \
        [--out runs/ablations]

``--dry-run`` restricts to the listed participants (which live in different
folds; fold settings with no train or no eval participants are skipped and the
skip is recorded), overrides epochs, and uses copies=1 / draws=5. It exercises
all six variants including the linear64 and cap_next_onset code paths.
"""
from __future__ import annotations

import argparse
import contextlib
import csv
import json
import logging
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import yaml

from . import frontend, patches
from .evaluate import (
    CLASSES,
    _assert_not_test,
    _dataset_of,
    _fold_order,
    _inner_split,
    _load_splits,
    _to_five_shot_meta,
)
from .patches import build_patch_cache
from .prototypes import factory_prototypes, five_shot_eval
from .train import embed_all, train_encoder

logger = logging.getLogger(__name__)

# training/ (parent of beatrice_ml/)
_ROOT = Path(__file__).resolve().parent.parent

SEED = 1729
# Fixed adaptation strength for the variant comparison. No per-variant tau search
# (that would inject variance): the comparison must be identical across variants.
_ABLATION_TAU = 10.0

# Pre-registered decision-rule thresholds, in percentage points of macro accuracy.
_AB_SWITCH_PP = 1.0
_LINEAR_SWITCH_PP = 1.0
_LINEAR_HIHAT_MATERIAL_LOSS_PP = 2.0
_ESCALATE_LATENCY_PP = 3.0

# Crop comparison variants (all mel64). (name, pre_s, post_s, cap_next_onset).
_CROP_VARIANTS = [
    ("A", 0.025, 0.125, False),
    ("B", 0.0, 0.150, False),
    ("C", 0.0, 0.300, True),
    ("D", 0.0, 0.560, True),
]


def _pct(x: float) -> float:
    """Fraction -> percentage points, rounded for readable JSON."""
    return round(float(x) * 100.0, 4)


@contextlib.contextmanager
def _frontend_override(patch_fn):
    """Temporarily swap the frontend that build_patch_cache calls.

    ``build_patch_cache`` (a consume-only interface we must not modify) resolves
    ``logmel_patch`` as a module global, so swapping ``patches.logmel_patch`` for
    ``frontend.linear64_patch`` lets us reuse the exact augmentation/caching loop
    for the linear64 frontend without duplicating it. ``linear64_patch`` has the
    same signature and output contract ((n_bins, F) float32 in [0, 1]).
    """
    original = patches.logmel_patch
    patches.logmel_patch = patch_fn
    try:
        yield
    finally:
        patches.logmel_patch = original


def _load_manifest(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _git_sha() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_ROOT), capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return None


def _build_variant_cache(variant: dict, manifest_rows, roots, cache_participants,
                         cache_dir: Path, copies: int) -> Path:
    """Build the per-variant npz patch cache (distinct filename per variant)."""
    cache = cache_dir / f"patches_{variant['name']}.npz"
    patch_fn = (frontend.linear64_patch if variant["frontend"] == "linear64"
                else frontend.logmel_patch)
    logger.info("building cache %s (frontend=%s crop=(%.3f,%.3f) cap=%s copies=%d)",
                cache.name, variant["frontend"], variant["pre_s"],
                variant["post_s"], variant["cap"], copies)
    with _frontend_override(patch_fn):
        build_patch_cache(
            manifest_rows, roots, cache,
            crop=(variant["pre_s"], variant["post_s"]),
            copies=copies, seed=SEED,
            participants=cache_participants,
            cap_next_onset=variant["cap"],
        )
    return cache


def _evaluate_variant(cache: Path, splits: dict, restrict: set, config: dict,
                      draws: int, support_k: int) -> dict:
    """Run the inner-folds-only protocol for one variant's cache.

    Returns per-fold macro accuracy (pp), the mean over evaluated folds, pooled
    hi-hat recall (pp), and any skipped fold settings.
    """
    test = set(splits["test_participants"])
    dev_folds = splits["dev_outer_folds"]
    fold_names = _fold_order(dev_folds)

    per_fold: dict = {}
    skipped: list[dict] = []
    hihat_recalls: list[float] = []

    for outer in fold_names:
        train_folds, val_fold = _inner_split(fold_names, outer)
        enc_train = [p for f in train_folds for p in dev_folds[f] if p in restrict]
        enc_val = [p for p in dev_folds[val_fold] if p in restrict]

        # Never touch locked-test participants.
        _assert_not_test(enc_train, test)
        _assert_not_test(enc_val, test)

        if not enc_train:
            skipped.append({"outer": outer, "encoder_val_fold": val_fold,
                            "reason": "no_train_participants"})
            continue
        if not enc_val:
            skipped.append({"outer": outer, "encoder_val_fold": val_fold,
                            "reason": "no_eval_participants"})
            continue

        with tempfile.TemporaryDirectory(prefix=f"ablate_{outer}_") as tmp:
            ckpt = train_encoder(cache, enc_train, enc_val, config, SEED, tmp)

            train_emb, train_meta = embed_all(ckpt, cache, enc_train)
            protos = factory_prototypes(train_emb, train_meta["instrument3"],
                                        train_meta["participant"])

            val_emb, val_meta = embed_all(ckpt, cache, enc_val)
            fs_meta = _to_five_shot_meta(val_meta)

            fold_macros: list[float] = []
            fold_hihat: list[float] = []
            for pid in enc_val:
                r = five_shot_eval(val_emb, fs_meta, pid, protos, _ABLATION_TAU,
                                   k=support_k, draws=draws, seed=SEED,
                                   classes=CLASSES)
                fold_macros.append(float(r["macro_accuracy"]))
                if "hihat" in r["per_class_recall"]:
                    fold_hihat.append(float(r["per_class_recall"]["hihat"]))
                    hihat_recalls.append(float(r["per_class_recall"]["hihat"]))

        per_fold[val_fold] = {
            "macro_pp": _pct(float(np.mean(fold_macros))),
            "n_eval_participants": len(enc_val),
            "n_train_participants": len(enc_train),
            "hihat_recall_pp": _pct(float(np.mean(fold_hihat))) if fold_hihat else None,
        }

    fold_means = [v["macro_pp"] for v in per_fold.values()]
    return {
        "per_fold": per_fold,
        "mean_macro_pp": round(float(np.mean(fold_means)), 4) if fold_means else None,
        "mean_hihat_recall_pp": _pct(float(np.mean(hihat_recalls))) if hihat_recalls else None,
        "n_folds_evaluated": len(per_fold),
        "skipped_folds": skipped,
    }


def _make_variant(name: str, frontend_name: str, pre_s: float, post_s: float,
                  cap: bool) -> dict:
    return {"name": name, "frontend": frontend_name,
            "pre_s": pre_s, "post_s": post_s, "cap": cap}


def run_ablations(config: dict, config_path: str, splits, manifest_rows, roots,
                  restrict: set, out_dir: Path, *, dry_run: bool,
                  copies: int, draws: int, support_k: int) -> dict:
    """Build every variant cache, train/evaluate each, apply the pre-registered
    decision rules, and return the results dict written to ablations.json."""
    splits = _load_splits(splits)
    test = set(splits["test_participants"])
    # Guard the whole restriction set up front — no locked-test participant is
    # ever cached, trained, or evaluated.
    _assert_not_test(restrict, test)

    cache_participants = sorted(restrict)
    cache_dir = out_dir / "caches"
    cache_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    variants: dict = {}

    # ---- crop comparison (mel64): A, B, C, D ---- #
    for name, pre_s, post_s, cap in _CROP_VARIANTS:
        v = _make_variant(f"{name}_mel64", "mel64", pre_s, post_s, cap)
        cache = _build_variant_cache(v, manifest_rows, roots, cache_participants,
                                     cache_dir, copies)
        res = _evaluate_variant(cache, splits, restrict, config, draws, support_k)
        variants[v["name"]] = {**{"frontend": "mel64",
                                  "crop": {"pre_s": pre_s, "post_s": post_s,
                                           "cap_next_onset": cap}}, **res}
        logger.info("variant %s mean_macro=%s pp", v["name"], res["mean_macro_pp"])

    a_mean = variants["A_mel64"]["mean_macro_pp"] or 0.0
    b_mean = variants["B_mel64"]["mean_macro_pp"] or 0.0
    c_mean = variants["C_mel64"]["mean_macro_pp"] or 0.0
    d_mean = variants["D_mel64"]["mean_macro_pp"] or 0.0

    # ---- decision 1: A -> B crop switch ---- #
    ab_margin = round(b_mean - a_mean, 4)
    ab_winner = "B" if ab_margin >= _AB_SWITCH_PP else "A"
    win_name, win_pre, win_post, win_cap = next(
        v for v in _CROP_VARIANTS if v[0] == ab_winner)
    mel_winner_key = f"{ab_winner}_mel64"
    win_mean = variants[mel_winner_key]["mean_macro_pp"] or 0.0

    crop_ab_decision = {
        "rule": "switch A->B only if (B - A) >= +1.0 pp macro accuracy",
        "A_mean_macro_pp": a_mean,
        "B_mean_macro_pp": b_mean,
        "margin_pp": ab_margin,
        "threshold_pp": _AB_SWITCH_PP,
        "chosen_crop": ab_winner,
        "chosen_crop_variant": mel_winner_key,
    }

    # ---- frontend comparison at the winner crop: linear64 (fresh) vs mel64 ---- #
    lin = _make_variant(f"{ab_winner}_linear64", "linear64", win_pre, win_post, win_cap)
    lin_cache = _build_variant_cache(lin, manifest_rows, roots, cache_participants,
                                     cache_dir, copies)
    lin_res = _evaluate_variant(lin_cache, splits, restrict, config, draws, support_k)
    variants[lin["name"]] = {**{"frontend": "linear64",
                                "crop": {"pre_s": win_pre, "post_s": win_post,
                                         "cap_next_onset": win_cap}}, **lin_res}
    logger.info("variant %s mean_macro=%s pp", lin["name"], lin_res["mean_macro_pp"])

    mel_hihat = variants[mel_winner_key]["mean_hihat_recall_pp"]
    lin_hihat = lin_res["mean_hihat_recall_pp"]
    lin_mean = lin_res["mean_macro_pp"] or 0.0
    frontend_margin = round(lin_mean - win_mean, 4)
    hihat_loss_pp = (round((mel_hihat or 0.0) - (lin_hihat or 0.0), 4)
                     if mel_hihat is not None and lin_hihat is not None else None)
    material_hihat_loss = (hihat_loss_pp is not None
                           and hihat_loss_pp > _LINEAR_HIHAT_MATERIAL_LOSS_PP)
    adopt_linear = (frontend_margin >= _LINEAR_SWITCH_PP) and (not material_hihat_loss)

    frontend_decision = {
        "rule": ("adopt linear64 only if (linear - mel) >= +1.0 pp macro accuracy "
                 "AND no material hi-hat recall loss (mel - linear hi-hat recall "
                 "<= 2.0 pp)"),
        "crop": ab_winner,
        "mel64_mean_macro_pp": win_mean,
        "linear64_mean_macro_pp": lin_mean,
        "margin_pp": frontend_margin,
        "threshold_pp": _LINEAR_SWITCH_PP,
        "mel64_hihat_recall_pp": mel_hihat,
        "linear64_hihat_recall_pp": lin_hihat,
        "hihat_recall_loss_pp": hihat_loss_pp,
        "material_hihat_loss_threshold_pp": _LINEAR_HIHAT_MATERIAL_LOSS_PP,
        "material_hihat_loss": material_hihat_loss,
        "adopt_linear": bool(adopt_linear),
    }

    # ---- decision 3: latency escalation ---- #
    best_long = max(c_mean, d_mean)
    latency_margin = round(best_long - win_mean, 4)
    escalate = latency_margin >= _ESCALATE_LATENCY_PP
    latency_decision = {
        "rule": ("if C or D beats the chosen 150ms crop by >= 3.0 pp -> "
                 "flag ESCALATE_LATENCY"),
        "chosen_150ms_crop": ab_winner,
        "chosen_150ms_mean_macro_pp": win_mean,
        "C_mean_macro_pp": c_mean,
        "D_mean_macro_pp": d_mean,
        "best_long_crop_mean_macro_pp": best_long,
        "margin_pp": latency_margin,
        "threshold_pp": _ESCALATE_LATENCY_PP,
        "escalate": bool(escalate),
        "flag": "ESCALATE_LATENCY" if escalate else None,
    }

    wall_s = round(time.time() - t0, 1)
    return {
        "meta": {
            "task": "stage1-ablations",
            "seed": SEED,
            "mode": "dry_run" if dry_run else "full",
            "config_path": config_path,
            "git_sha": _git_sha(),
            "ablation_tau": _ABLATION_TAU,
            "support_k": support_k,
            "copies_per_event": copies,
            "eval_draws": draws,
            "max_epochs": int(config.get("train", {}).get("max_epochs")),
            "restricted_participants": sorted(restrict),
            "n_restricted_participants": len(restrict),
            "wall_time_seconds": wall_s,
        },
        "protocol": (
            "inner-folds-only; one seed; for each outer fold F_i the encoder is "
            "trained on the 3 dev folds excluding F_i and its successor "
            "(encoder_val), factory prototypes are built from encoder_train, and "
            "the encoder_val fold's participants are 5-shot evaluated at fixed "
            "tau; outer-fold participants are never touched; mean over the 5 "
            "inner settings. Identical for every variant."
        ),
        "variants": variants,
        "decisions": {
            "crop_ab": crop_ab_decision,
            "frontend_mel_vs_linear": frontend_decision,
            "latency": latency_decision,
        },
    }


def _dev_participants(splits: dict) -> set:
    return {p for fold in splits["dev_outer_folds"].values() for p in fold}


def main(argv=None) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    ap = argparse.ArgumentParser(description="Stage-1 crop & frontend ablations")
    ap.add_argument("--config", default="configs/avplvt_v1.yaml")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--participants", default=None,
                    help="comma-separated participant ids (dry-run restriction)")
    ap.add_argument("--epochs", type=int, default=None,
                    help="override max_epochs (dry-run)")
    ap.add_argument("--out", default="runs/ablations")
    args = ap.parse_args(argv)

    config_path = Path(args.config)
    if not config_path.exists():
        config_path = _ROOT / args.config
    config = yaml.safe_load(config_path.read_text())

    data_cfg = config.get("data", {})
    manifest_path = Path(data_cfg.get("manifest", "data/manifest.csv"))
    if not manifest_path.is_absolute():
        manifest_path = _ROOT / manifest_path
    splits_path = Path(data_cfg.get("splits", "splits/avplvt_v1.json"))
    if not splits_path.is_absolute():
        splits_path = _ROOT / splits_path

    roots = {
        "avp_personal": Path(data_cfg["avp_root"]).expanduser(),
        "lvt": Path(data_cfg["lvt_root"]).expanduser(),
    }

    manifest_rows = _load_manifest(manifest_path)
    splits = _load_splits(splits_path)

    proto_cfg = config.get("prototypes", {})
    support_k = int(proto_cfg.get("support_k", 5))

    if args.dry_run:
        if not args.participants:
            ap.error("--dry-run requires --participants")
        restrict = {p.strip() for p in args.participants.split(",") if p.strip()}
        copies, draws = 1, 5
        if args.epochs is not None:
            config["train"] = {**config.get("train", {}), "max_epochs": args.epochs}
    else:
        restrict = _dev_participants(splits)
        copies = int(config.get("augment", {}).get("copies_per_event", 10))
        draws = int(proto_cfg.get("eval_draws", 100))
        if args.epochs is not None:
            config["train"] = {**config.get("train", {}), "max_epochs": args.epochs}

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = _ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    results = run_ablations(
        config, str(args.config), splits, manifest_rows, roots, restrict,
        out_dir, dry_run=args.dry_run, copies=copies, draws=draws,
        support_k=support_k)

    out_json = out_dir / "ablations.json"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    logger.info("wrote %s", out_json)
    print(json.dumps({
        "mode": results["meta"]["mode"],
        "wall_time_seconds": results["meta"]["wall_time_seconds"],
        "crop_ab_chosen": results["decisions"]["crop_ab"]["chosen_crop"],
        "adopt_linear": results["decisions"]["frontend_mel_vs_linear"]["adopt_linear"],
        "escalate_latency": results["decisions"]["latency"]["escalate"],
        "out": str(out_json),
    }))


if __name__ == "__main__":
    main()
