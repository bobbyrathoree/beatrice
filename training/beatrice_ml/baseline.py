"""Nested-OOF efficacy-gate driver for the two crop candidates (Task 11, Step 2).

This is the module the EC2 run executes to produce the efficacy-gate numbers.
Everything it orchestrates already exists in ``evaluate.py`` / ``patches.py`` /
``train.py``; this driver only wires them together, writes durable per-seed
outputs, and computes the gate for each crop.

Crop escalation
---------------
The crop ablation escalated: rather than pick a single crop, the human decided
to run the FULL efficacy gate for BOTH crop candidates and freeze the contract
on the gate numbers. The two variants:

  * ``crop_A`` — (pre=0.025, post=0.125), cap_next_onset=False  (the shipped crop)
  * ``crop_C`` — (pre=0.0,   post=0.300), cap_next_onset=True   (long-window)

For each variant we build one full-dev patch cache and, for each config seed,
run the nested-OOF CNN evaluation and the matched Gaussian baseline, then feed
both into ``gate_report``.

Locked TEST set
---------------
The eight ``test_participants`` are never cached, trained, or evaluated. The
patch cache is built for DEV participants only (locked TEST excluded as build
inputs, exactly like ablate.py), and evaluate.py's own ``_assert_not_test``
guards fire inside every run.

Gaussian seeding
----------------
``matched_gaussian_baseline``'s factory Gaussian fit is seed-independent, but its
5-shot support draws (``_gaussian_shot_eval``) ARE seeded. ``gate_report`` only
consumes the seed-1729 Gaussian result (its paired bootstrap is seeded 1729), but
we still run the Gaussian once per config seed and thread the per-seed value so
each ``raw_gaussian_*`` dump is self-consistent with its CNN counterpart and the
gate's bootstrap draws are exactly reproducible. Note crop_C's ``cap_next_onset``
is a cache/frontend option the Gaussian recipe does not expose, so the matched
Gaussian for crop_C uses the (0.0, 0.300) crop WITHOUT the next-onset cap.

Durability
----------
Each ``raw_<variant>_seed<seed>.json`` (CNN) and ``raw_gaussian_<variant>_seed<
seed>.json`` is written IMMEDIATELY after its run completes so the 10-minute S3
sync of ``runs/<run-id>/`` can pick it up even if a later run dies. All outputs
live under ``--out`` (REQUIRED, no default) — a previous run lost its JSON by
writing elsewhere and the EC2 sync only covers ``runs/<run-id>/``.

CLI
---
    uv run python -m beatrice_ml.baseline --config configs/avplvt_v1.ec2.yaml \
        --out runs/<run-id>

    # local plumbing check (tiny cache, both variants end-to-end):
    uv run python -m beatrice_ml.baseline --config configs/avplvt_v1.yaml \
        --dry-run --participants avp:1,avp:2,avp:3,lvt:Bea --epochs 2 \
        --out runs/baseline-dry
"""
from __future__ import annotations

import argparse
import copy
import json
import logging
import time
from pathlib import Path

import yaml

from .ablate import _dev_participants, _git_sha, _load_manifest
from .evaluate import (
    _assert_not_test,
    _fold_order,
    _load_splits,
    gate_report,
    matched_gaussian_baseline,
    nested_oof_run,
)
from .patches import build_patch_cache

logger = logging.getLogger(__name__)

# training/ (parent of beatrice_ml/)
_ROOT = Path(__file__).resolve().parent.parent

# Fixed seed for the (deterministic) augmentation rng in the patch cache. This is
# independent of the eval seeds swept below; the augmentation is keyed per event.
_CACHE_SEED = 1729

# The two crop candidates. (name, crop_pre_s, crop_post_s, cap_next_onset.)
_CROP_VARIANTS = [
    {"name": "crop_A", "pre_s": 0.025, "post_s": 0.125, "cap": False},
    {"name": "crop_C", "pre_s": 0.0, "post_s": 0.300, "cap": True},
]


def _variant_config(base_config: dict, variant: dict) -> dict:
    """Deep-copy the config and set the frontend crop to the variant's crop so
    the matched Gaussian (which reads ``frontend.crop_pre_s`` / ``crop_post_s``)
    uses the same crop as the CNN's cache for this variant."""
    cfg = copy.deepcopy(base_config)
    cfg.setdefault("frontend", {})
    cfg["frontend"]["crop_pre_s"] = variant["pre_s"]
    cfg["frontend"]["crop_post_s"] = variant["post_s"]
    return cfg


def _restrict_splits(splits: dict, restrict: set) -> dict:
    """Return a splits dict whose ``dev_outer_folds`` keeps only participants in
    ``restrict``, dropping any fold left empty. ``test_participants`` is
    preserved verbatim.

    In the full run ``restrict`` is the entire dev pool, so this is a no-op. In
    ``--dry-run`` it collapses the fold set to just the restricted participants'
    folds, which keeps every ``encoder_val`` non-empty — ``nested_oof_run`` is
    not restrict-aware and would otherwise hit an empty inner-val fold and crash
    in ``select_tau`` (``float(None)``)."""
    restrict = set(restrict)
    dev = splits["dev_outer_folds"]
    new_folds = {}
    for f in _fold_order(dev):
        members = [p for p in dev[f] if p in restrict]
        if members:
            new_folds[f] = members
    out = dict(splits)
    out["dev_outer_folds"] = new_folds
    return out


def _dump(path: Path, obj) -> None:
    """Write JSON with a str fallback for any stray non-serializable values.

    ``nested_oof_run`` / ``matched_gaussian_baseline`` already return plain
    Python floats, but ``default=str`` is a cheap guard against any numpy scalar
    slipping through so a durable dump never fails mid-run."""
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str))


def _variant_summary(variant_name: str, gate: dict | None,
                     gate_error: str | None) -> dict:
    """Compact one-line-able summary of a variant's gate result."""
    if gate is None:
        return {"variant": variant_name, "gate_error": gate_error, "PASS": None}
    return {
        "variant": variant_name,
        "pooled_mean_5shot": gate["pooled_mean_5shot"],
        "per_seed_5shot": gate["per_seed_5shot"],
        "worst_class_recall": gate["worst_class_recall"],
        "bootstrap_lower95": gate["bootstrap_lower95"],
        "PASS": gate["verdicts"]["PASS"],
    }


def run_variant(variant: dict, base_config: dict, splits: dict, manifest_rows,
                roots, restrict: set, seeds, out_dir: Path, cache_dir: Path,
                *, copies: int) -> dict:
    """Build one variant's cache, run CNN + Gaussian for every seed (dumping each
    raw result immediately), compute the gate, and return the summary."""
    name = variant["name"]
    cfg = _variant_config(base_config, variant)
    eval_splits = _restrict_splits(splits, restrict)
    test = set(splits["test_participants"])
    cache_participants = sorted(restrict)
    _assert_not_test(cache_participants, test)

    cache = cache_dir / f"patches_{name}.npz"
    logger.info("[%s] building cache %s crop=(%.3f,%.3f) cap=%s copies=%d "
                "participants=%d", name, cache.name, variant["pre_s"],
                variant["post_s"], variant["cap"], copies, len(cache_participants))
    t_cache = time.time()
    build_patch_cache(
        manifest_rows, roots, cache,
        crop=(variant["pre_s"], variant["post_s"]),
        copies=copies, seed=_CACHE_SEED,
        participants=cache_participants,
        cap_next_onset=variant["cap"],
        workers=None,
        frontend_kind="mel64",
    )
    logger.info("[%s] cache built in %.1fs", name, time.time() - t_cache)

    runs_by_seed: dict = {}
    gaussian_by_seed: dict = {}
    for seed in seeds:
        seed = int(seed)

        logger.info("[%s] seed %d: starting nested_oof_run (CNN)", name, seed)
        t0 = time.time()
        cnn = nested_oof_run(cfg, cache, eval_splits, seed, mode="cnn")
        raw_cnn = out_dir / f"raw_{name}_seed{seed}.json"
        _dump(raw_cnn, cnn)
        runs_by_seed[seed] = cnn
        logger.info("[%s] seed %d: CNN done in %.1fs -> %s (5shot pooled=%.4f)",
                    name, seed, time.time() - t0, raw_cnn.name,
                    cnn["aggregate"]["5shot"]["all"])

        logger.info("[%s] seed %d: starting matched_gaussian_baseline", name, seed)
        t1 = time.time()
        gauss = matched_gaussian_baseline(cfg, manifest_rows, roots, eval_splits,
                                          seed)
        raw_gauss = out_dir / f"raw_gaussian_{name}_seed{seed}.json"
        _dump(raw_gauss, gauss)
        gaussian_by_seed[seed] = gauss
        logger.info("[%s] seed %d: Gaussian done in %.1fs -> %s (5shot pooled=%.4f)",
                    name, seed, time.time() - t1, raw_gauss.name,
                    gauss["aggregate"]["5shot"]["all"])

    # Gate — wrapped so a tiny dry-run (bootstrap on very few participants, or a
    # missing bootstrap seed) records the error string instead of crashing the
    # whole plumbing check.
    gate: dict | None = None
    gate_error: str | None = None
    try:
        gate = gate_report(runs_by_seed, gaussian_by_seed)
    except Exception as exc:  # noqa: BLE001 — plumbing durability, record & continue
        gate_error = f"{type(exc).__name__}: {exc}"
        logger.warning("[%s] gate_report failed: %s", name, gate_error)

    gate_path = out_dir / f"gate_{name}.json"
    _dump(gate_path, gate if gate is not None else {"error": gate_error})

    summary = _variant_summary(name, gate, gate_error)
    if gate is not None:
        logger.info("[%s] SUMMARY pooled_mean_5shot=%.4f per_seed=%s "
                    "worst_class_recall=%.4f bootstrap_lower95=%.4f PASS=%s",
                    name, gate["pooled_mean_5shot"], gate["per_seed_5shot"],
                    gate["worst_class_recall"], gate["bootstrap_lower95"],
                    gate["verdicts"]["PASS"])
    else:
        logger.info("[%s] SUMMARY gate_error=%s", name, gate_error)
    return summary


def main(argv=None) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    ap = argparse.ArgumentParser(
        description="Nested-OOF efficacy-gate driver for both crop candidates")
    ap.add_argument("--config", default="configs/avplvt_v1.yaml")
    # REQUIRED: the EC2 sync only covers runs/<run-id>/; a previous run lost its
    # JSON by writing elsewhere. No default.
    ap.add_argument("--out", required=True,
                    help="output dir (all outputs written here); REQUIRED")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--participants", default=None,
                    help="comma-separated participant ids (dry-run restriction)")
    ap.add_argument("--epochs", type=int, default=None,
                    help="override max_epochs (dry-run)")
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
    seeds = list(config.get("seeds", [1729, 2718, 31415]))

    if args.dry_run:
        if not args.participants:
            ap.error("--dry-run requires --participants")
        restrict = {p.strip() for p in args.participants.split(",") if p.strip()}
        copies = 1
        # Tiny eval draws for the plumbing check (threaded through config for both
        # nested_oof_run and matched_gaussian_baseline, which read eval_draws).
        config.setdefault("prototypes", {})["eval_draws"] = 5
        if args.epochs is not None:
            config["train"] = {**config.get("train", {}), "max_epochs": args.epochs}
    else:
        restrict = _dev_participants(splits)
        copies = int(config.get("augment", {}).get("copies_per_event", 10))
        if args.epochs is not None:
            config["train"] = {**config.get("train", {}), "max_epochs": args.epochs}

    # Guard the whole restriction set up front — no locked-TEST participant is
    # ever cached, trained, or evaluated.
    _assert_not_test(restrict, set(splits["test_participants"]))

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = _ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = out_dir / "caches"
    cache_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    logger.info("baseline driver: mode=%s seeds=%s variants=%s out=%s",
                "dry_run" if args.dry_run else "full", seeds,
                [v["name"] for v in _CROP_VARIANTS], out_dir)

    summaries = {}
    for variant in _CROP_VARIANTS:
        summaries[variant["name"]] = run_variant(
            variant, config, splits, manifest_rows, roots, restrict, seeds,
            out_dir, cache_dir, copies=copies)

    wall_s = round(time.time() - t0, 1)
    final = {
        "mode": "dry_run" if args.dry_run else "full",
        "git_sha": _git_sha(),
        "seeds": [int(s) for s in seeds],
        "config_path": str(args.config),
        "wall_time_seconds": wall_s,
        "variants": summaries,
        "out": str(out_dir),
    }
    _dump(out_dir / "baseline_summary.json", final)
    logger.info("baseline driver done in %.1fs -> %s", wall_s, out_dir)
    print(json.dumps(final, default=str))


if __name__ == "__main__":
    main()
