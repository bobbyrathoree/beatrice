# training/tests/test_gate.py
"""Unit tests for the efficacy-gate aggregation and paired participant bootstrap
in beatrice_ml.evaluate. Pure numerics — no encoder training, no EC2, no audio.
Synthetic run dicts mirror the shape nested_oof_run / matched_gaussian_baseline
return."""
import numpy as np

from beatrice_ml.evaluate import (
    CLASSES,
    gate_report,
    paired_bootstrap_lower95,
)


# --------------------------------------------------------------------------- #
# Bootstrap
# --------------------------------------------------------------------------- #
def test_bootstrap_known_positive_deltas_lower95_above_zero():
    rng = np.random.default_rng(0)
    deltas = rng.normal(0.05, 0.01, 40)  # tightly positive
    assert paired_bootstrap_lower95(deltas) > 0.0


def test_bootstrap_known_zero_deltas_straddles_zero():
    rng = np.random.default_rng(7)
    deltas = rng.normal(0.0, 0.05, 40)  # centered on zero, wide
    assert paired_bootstrap_lower95(deltas) < 0.0


def test_bootstrap_is_deterministic_given_seed():
    rng = np.random.default_rng(123)
    deltas = rng.normal(0.03, 0.02, 40)
    a = paired_bootstrap_lower95(deltas, seed=1729)
    b = paired_bootstrap_lower95(deltas, seed=1729)
    assert a == b


def test_bootstrap_different_seed_differs():
    rng = np.random.default_rng(9)
    deltas = rng.normal(0.03, 0.02, 40)
    a = paired_bootstrap_lower95(deltas, seed=1729)
    b = paired_bootstrap_lower95(deltas, seed=2718)
    assert a != b


def test_bootstrap_empty_raises():
    try:
        paired_bootstrap_lower95([])
    except ValueError:
        return
    raise AssertionError("expected ValueError on empty deltas")


# --------------------------------------------------------------------------- #
# Synthetic run-dict builders (mirror nested_oof_run's result shape)
# --------------------------------------------------------------------------- #
def _make_run(seed, macro_5shot, per_class_recall, n=40, delta=0.05,
              macro_0shot=None, macro_full=None, avp_frac=0.5, mode="cnn"):
    """Build a nested_oof_run-style dict. Each participant gets the same 5-shot
    macro (so the pooled mean equals ``macro_5shot``) and the same per-class
    recall. ``delta`` is subtracted from each participant's macro to synthesize
    the paired Gaussian baseline when ``mode='matched_gaussian'`` callers pass a
    lowered ``macro_5shot`` instead — here we just build one side at a time."""
    macro_0shot = macro_5shot - 0.1 if macro_0shot is None else macro_0shot
    macro_full = macro_5shot + 0.05 if macro_full is None else macro_full
    n_avp = int(round(n * avp_frac))
    per_participant = {}
    for i in range(n):
        ds = "avp" if i < n_avp else "lvt"
        pid = f"{ds}:{i}"
        per_participant[pid] = {
            "0shot": macro_0shot,
            "5shot": macro_5shot,
            "full": macro_full,
            "per_class_recall_5shot": dict(per_class_recall),
            "n_query_classes": len(per_class_recall),
        }

    def _sub(mode_key):
        vals_all = [p[mode_key] for p in per_participant.values()]
        vals_avp = [p[mode_key] for pid, p in per_participant.items()
                    if pid.startswith("avp")]
        vals_lvt = [p[mode_key] for pid, p in per_participant.items()
                    if pid.startswith("lvt")]
        return {
            "all": float(np.mean(vals_all)),
            "avp": float(np.mean(vals_avp)) if vals_avp else 0.0,
            "lvt": float(np.mean(vals_lvt)) if vals_lvt else 0.0,
            "n_all": len(vals_all), "n_avp": len(vals_avp), "n_lvt": len(vals_lvt),
        }

    return {
        "mode": mode,
        "seed": seed,
        "per_participant": per_participant,
        "aggregate": {m: _sub(m) for m in ("0shot", "5shot", "full")},
    }


def _passing_recall():
    return {c: 0.9 for c in CLASSES}


def _build_pair(cnn_macros, gauss_macro=0.80, recall_by_seed=None):
    """cnn_macros: {seed: macro_5shot}. Returns (runs_by_seed, gaussian_by_seed)
    with CNN clearly above the Gaussian baseline (so bootstrap lower95 > 0)."""
    runs, gauss = {}, {}
    for seed, macro in cnn_macros.items():
        recall = (recall_by_seed or {}).get(seed, _passing_recall())
        runs[seed] = _make_run(seed, macro, recall, mode="cnn")
        gauss[seed] = _make_run(seed, gauss_macro, {c: 0.7 for c in CLASSES},
                                mode="matched_gaussian")
    return runs, gauss


# --------------------------------------------------------------------------- #
# gate_report
# --------------------------------------------------------------------------- #
def test_gate_report_all_pass():
    runs, gauss = _build_pair({1729: 0.91, 2718: 0.90, 31415: 0.92})
    rep = gate_report(runs, gauss)
    v = rep["verdicts"]
    assert v["mean_ok"] is True
    assert v["seeds_ok"] is True
    assert v["classes_ok"] is True
    assert v["bootstrap_ok"] is True
    assert v["PASS"] is True
    assert abs(rep["pooled_mean_5shot"] - (0.91 + 0.90 + 0.92) / 3) < 1e-9
    assert rep["bootstrap_lower95"] > 0.0
    assert rep["n_bootstrap_participants"] == 40


def test_gate_report_fails_on_one_low_seed():
    # One seed at 0.87 (< 0.880) trips seeds_ok only; mean stays high enough.
    runs, gauss = _build_pair({1729: 0.93, 2718: 0.87, 31415: 0.93})
    rep = gate_report(runs, gauss)
    v = rep["verdicts"]
    assert v["mean_ok"] is True          # (0.93+0.87+0.93)/3 = 0.910 >= 0.900
    assert v["seeds_ok"] is False        # 0.87 < 0.880
    assert v["classes_ok"] is True
    assert v["bootstrap_ok"] is True
    assert v["PASS"] is False


def test_gate_report_fails_on_low_class_recall():
    recall = {c: 0.9 for c in CLASSES}
    recall[CLASSES[2]] = 0.75  # < 0.800
    runs, gauss = _build_pair(
        {1729: 0.91, 2718: 0.91, 31415: 0.91},
        recall_by_seed={1729: recall, 2718: recall, 31415: recall})
    rep = gate_report(runs, gauss)
    v = rep["verdicts"]
    assert v["mean_ok"] is True
    assert v["seeds_ok"] is True
    assert v["classes_ok"] is False
    assert rep["worst_class_recall"] < 0.800
    assert v["PASS"] is False


def test_gate_report_fails_on_low_mean():
    # All seeds >= 0.880 but 3-seed mean < 0.900.
    runs, gauss = _build_pair({1729: 0.88, 2718: 0.885, 31415: 0.89})
    rep = gate_report(runs, gauss)
    v = rep["verdicts"]
    assert v["mean_ok"] is False
    assert v["seeds_ok"] is True
    assert v["PASS"] is False


def test_gate_report_fails_on_bootstrap():
    # CNN essentially ties the Gaussian baseline -> lower95 not above zero.
    runs, gauss = _build_pair({1729: 0.91, 2718: 0.91, 31415: 0.91},
                              gauss_macro=0.91)
    rep = gate_report(runs, gauss)
    v = rep["verdicts"]
    assert v["mean_ok"] is True
    assert v["bootstrap_ok"] is False
    assert v["PASS"] is False


def test_gate_report_breakdowns_present():
    runs, gauss = _build_pair({1729: 0.91, 2718: 0.90, 31415: 0.92})
    rep = gate_report(runs, gauss)
    assert set(rep["avp_only"]) == {"0shot", "5shot", "full"}
    assert set(rep["lvt_only"]) == {"0shot", "5shot", "full"}
    assert set(rep["per_seed_5shot"]) == {1729, 2718, 31415}
    assert "pooled_mean_0shot" in rep["secondaries"]
    assert "pooled_mean_full" in rep["secondaries"]
