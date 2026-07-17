import csv
from pathlib import Path
from beatrice_ml.manifest import (build_avp_manifest, build_lvt_manifest,
                                  parse_annotation_row, canon)

def test_canon_nfc_and_strip():
    assert canon(" p\r") == "p"

def test_parse_row_avp():
    r = parse_annotation_row(["0.1984", "kd", "p", "h"], dataset="avp_personal")
    assert r == {"onset_seconds": 0.1984, "instrument4": "kd",
                 "instrument3": "kick", "onset_phone": "p",
                 "coda_phone": "h", "syllable": "p_h"}

def test_parse_row_lvt():
    r = parse_annotation_row(["0.174489795", "HH", "ts", "x"], dataset="lvt")
    assert r["instrument3"] == "hihat"
    assert r["instrument4"] == "hihat"   # LVT has no 4-way split
    assert r["syllable"] == "ts_x"

def test_avp_manifest_on_synthetic_tree(tmp_path):
    d = tmp_path / "Participant_3"
    d.mkdir()
    (d / "P3_Kick_Personal.wav").write_bytes(b"RIFF")  # existence only
    (d / "P3_Kick_Personal.csv").write_text("0.10,kd,p,h\n0.50,kd,p,x\n")
    (d / "P3_Improvisation_Personal.wav").write_bytes(b"RIFF")
    (d / "P3_Improvisation_Personal.csv").write_text("0.20,sd,t,x\n")
    rows = build_avp_manifest(tmp_path, version="avplvt_v1")
    assert len(rows) == 3
    kicks = [r for r in rows if r["instrument4"] == "kd"]
    assert kicks[0]["role"] == "isolated"
    assert kicks[0]["participant"] == "avp:3"
    assert kicks[0]["instrument3"] == "kick"
    assert kicks[0]["next_onset_seconds"] == 0.50
    assert kicks[1]["next_onset_seconds"] == -1.0
    imp = [r for r in rows if r["role"] == "improvisation"][0]
    assert imp["instrument3"] == "snare"
    ids = {r["event_id"] for r in rows}
    assert len(ids) == 3  # deterministic + unique

def test_lvt_manifest_on_synthetic_tree(tmp_path):
    (tmp_path / "Frase").mkdir()
    (tmp_path / "Improviso").mkdir()
    (tmp_path / "Frase" / "JoSP3.wav").write_bytes(b"RIFF")
    (tmp_path / "Frase" / "JoSP.csv").write_text("0.10,Kick,p,x\n0.30,HH,ts,x\n")
    (tmp_path / "Improviso" / "JSoI3.wav").write_bytes(b"RIFF")  # code quirk
    (tmp_path / "Improviso" / "JSoI.csv").write_text("0.20,Snare,t,x\n")
    rows = build_lvt_manifest(tmp_path, version="avplvt_v1")
    assert len(rows) == 3
    assert all(r["dataset"] == "lvt" for r in rows)
    assert {r["participant"] for r in rows} == {"lvt:JoS"}  # JSo canonicalized
    frase = [r for r in rows if r["recording"] == "Frase"]
    assert all(r["role"] == "isolated" for r in frase)
    imp = [r for r in rows if r["recording"] == "Improviso"][0]
    assert imp["role"] == "improvisation"
    assert imp["instrument3"] == "snare"
