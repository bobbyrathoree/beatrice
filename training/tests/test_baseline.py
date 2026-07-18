"""Light tests for the nested-OOF gate driver (beatrice_ml.baseline).

These are plumbing/contract tests only — no encoder training, no audio. The
actual dry-run (which trains fold encoders) is exercised manually; here we pin
the crop variant table and the CLI contract (``--out`` required, splits
restriction helper)."""
import pytest

from beatrice_ml import baseline


def test_crop_variant_table_exact_values():
    """The two frozen crop candidates, exact values (crop_A shipped;
    crop_C long-window with next-onset cap)."""
    by_name = {v["name"]: v for v in baseline._CROP_VARIANTS}
    assert set(by_name) == {"crop_A", "crop_C"}

    a = by_name["crop_A"]
    assert (a["pre_s"], a["post_s"], a["cap"]) == (0.025, 0.125, False)

    c = by_name["crop_C"]
    assert (c["pre_s"], c["post_s"], c["cap"]) == (0.0, 0.300, True)


def test_missing_out_exits_nonzero():
    """--out is REQUIRED; argparse must exit nonzero when it is omitted."""
    with pytest.raises(SystemExit) as exc:
        baseline.main(["--config", "configs/avplvt_v1.yaml"])
    assert exc.value.code != 0


def test_restrict_splits_drops_empty_folds_and_keeps_test():
    """Restricting to a couple of dev participants keeps only their folds
    (non-empty) and preserves test_participants verbatim — so nested_oof_run
    never sees an empty inner-val fold in a dry-run."""
    splits = {
        "test_participants": ["avp:9", "lvt:AFR"],
        "dev_outer_folds": {
            "F1": ["avp:6", "lvt:Cat"],
            "F2": ["avp:5", "lvt:Bea"],
            "F3": ["avp:4", "lvt:Ric"],
        },
    }
    restricted = baseline._restrict_splits(splits, {"avp:5", "lvt:Bea"})
    assert restricted["dev_outer_folds"] == {"F2": ["avp:5", "lvt:Bea"]}
    assert restricted["test_participants"] == ["avp:9", "lvt:AFR"]
    # Original untouched.
    assert set(splits["dev_outer_folds"]) == {"F1", "F2", "F3"}


def test_variant_config_sets_crop_without_mutating_base():
    """_variant_config deep-copies and sets the frontend crop so the Gaussian
    baseline reads the variant's crop; the base config is not mutated."""
    base = {"frontend": {"crop_pre_s": 0.025, "crop_post_s": 0.125}}
    cfg = baseline._variant_config(base, baseline._CROP_VARIANTS[1])  # crop_C
    assert cfg["frontend"]["crop_pre_s"] == 0.0
    assert cfg["frontend"]["crop_post_s"] == 0.300
    # Base untouched.
    assert base["frontend"]["crop_pre_s"] == 0.025
