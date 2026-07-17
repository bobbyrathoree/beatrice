import json
from pathlib import Path

SPLITS = Path(__file__).parent.parent / "splits" / "avplvt_v1.json"

AVP_ALL = {f"avp:{n}" for n in range(1, 29)}
LVT_ALL = {f"lvt:{c}" for c in [
    "AFR", "AZi", "Bea", "Bic", "Cat", "Cav", "Cra", "Isa", "JOl", "JoS",
    "JSi", "Maf", "Mar", "MCo", "Nor", "Ric", "Rob", "Sof", "Zga", "Ziz"]}
TEST = ["avp:9", "avp:11", "avp:19", "avp:24",
        "lvt:AFR", "lvt:Cra", "lvt:Isa", "lvt:Mar"]

def load():
    return json.loads(SPLITS.read_text())

def test_test_participants_locked():
    assert load()["test_participants"] == TEST

def test_folds_partition_dev_exactly():
    s = load()
    dev = sorted(p for f in s["dev_outer_folds"].values() for p in f)
    assert dev == sorted((AVP_ALL | LVT_ALL) - set(TEST))
    assert len(dev) == 40  # no duplicates across folds

def test_no_test_leakage_into_folds():
    s = load()
    for fold in s["dev_outer_folds"].values():
        assert not set(fold) & set(s["test_participants"])

def test_every_fold_mixes_both_datasets():
    s = load()
    for fold in s["dev_outer_folds"].values():
        assert any(p.startswith("avp:") for p in fold)
        assert any(p.startswith("lvt:") for p in fold)

def test_class_missing_lvt_participants_in_separate_folds():
    # JOl (no HH in Improviso), Ric and Sof (no snare) each in a different fold
    s = load()
    for fold in s["dev_outer_folds"].values():
        assert len(set(fold) & {"lvt:JOl", "lvt:Ric", "lvt:Sof"}) <= 1
