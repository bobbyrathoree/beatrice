#!/usr/bin/env python3
"""Verify the AVP+LVT manifest against the datasets on disk.

Schema-only: reads the manifest CSV and audio *headers* (soundfile.info), never
audio content. Asserts the expected per-dataset totals, per-class counts, and
participant sets; confirms every referenced wav exists and is soundfile-readable;
prints per-participant event counts. Exits non-zero (via AssertionError) on any
mismatch so counts can get a human decision rather than silent fudging.
"""
import argparse
import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import soundfile as sf

# Expected AVP Personal counts.
AVP_TOTAL = 4873
AVP_CLASS = {"kd": 1447, "sd": 1253, "hhc": 1164, "hho": 1009}
AVP_PARTICIPANTS = {f"avp:{n}" for n in range(1, 29)}

# Expected LVT counts.
LVT_TOTAL = 841
LVT_CLASS = {"kick": 329, "snare": 178, "hihat": 334}
LVT_WAVS = 40
LVT_PARTICIPANTS = {f"lvt:{c}" for c in [
    "AFR", "AZi", "Bea", "Bic", "Cat", "Cav", "Cra", "Isa", "JOl", "JoS",
    "JSi", "Maf", "Mar", "MCo", "Nor", "Ric", "Rob", "Sof", "Zga", "Ziz"]}


def load_manifest(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _print_per_participant(rows: list[dict], label: str) -> None:
    counts = Counter(r["participant"] for r in rows)
    print(f"\n{label} per-participant event counts:")
    for participant in sorted(counts, key=lambda p: (p.split(":")[0], p)):
        print(f"  {participant:<10} {counts[participant]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest", type=Path, default=Path("data/manifest.csv"))
    ap.add_argument("--avp-root", type=Path, required=True)
    ap.add_argument("--lvt-root", type=Path, required=True)
    args = ap.parse_args()

    roots = {
        "avp_personal": args.avp_root.expanduser(),
        "lvt": args.lvt_root.expanduser(),
    }

    rows = load_manifest(args.manifest)
    avp = [r for r in rows if r["dataset"] == "avp_personal"]
    lvt = [r for r in rows if r["dataset"] == "lvt"]

    # ---- AVP assertions ----
    assert len(avp) == AVP_TOTAL, f"AVP total {len(avp)} != {AVP_TOTAL}"
    avp_class = Counter(r["instrument4"] for r in avp)
    for k, v in AVP_CLASS.items():
        assert avp_class[k] == v, f"AVP {k} {avp_class[k]} != {v}"
    avp_parts = {r["participant"] for r in avp}
    assert avp_parts == AVP_PARTICIPANTS, (
        f"AVP participants mismatch: missing={AVP_PARTICIPANTS - avp_parts} "
        f"extra={avp_parts - AVP_PARTICIPANTS}")

    # ---- LVT assertions ----
    assert len(lvt) == LVT_TOTAL, f"LVT total {len(lvt)} != {LVT_TOTAL}"
    lvt_class = Counter(r["instrument3"] for r in lvt)
    for k, v in LVT_CLASS.items():
        assert lvt_class[k] == v, f"LVT {k} {lvt_class[k]} != {v}"
    lvt_parts = {r["participant"] for r in lvt}
    assert lvt_parts == LVT_PARTICIPANTS, (
        f"LVT participants mismatch: missing={LVT_PARTICIPANTS - lvt_parts} "
        f"extra={lvt_parts - LVT_PARTICIPANTS}")
    assert len(lvt_parts) == 20, f"LVT participant count {len(lvt_parts)} != 20"
    lvt_wavs = {r["path"] for r in lvt}
    assert len(lvt_wavs) == LVT_WAVS, f"LVT wav count {len(lvt_wavs)} != {LVT_WAVS}"

    # ---- every wav exists + is soundfile-readable (header only) ----
    all_wavs = {(r["dataset"], r["path"]) for r in rows}
    unreadable = []
    for dataset, rel in sorted(all_wavs):
        wav = roots[dataset] / rel
        if not wav.exists():
            unreadable.append((str(wav), "missing"))
            continue
        try:
            sf.info(str(wav))  # header-only; touches no audio content
        except Exception as e:  # noqa: BLE001
            unreadable.append((str(wav), repr(e)))
    assert not unreadable, f"{len(unreadable)} unreadable wavs: {unreadable[:5]}"

    # ---- per-participant reporting ----
    _print_per_participant(avp, "AVP")
    _print_per_participant(lvt, "LVT")

    print()
    print(f"AVP {len(avp)} events / {len(avp_parts)} participants; "
          f"kd={avp_class['kd']} sd={avp_class['sd']} "
          f"hhc={avp_class['hhc']} hho={avp_class['hho']}.")
    print(f"LVT {len(lvt)} events / {len(lvt_parts)} participants; "
          f"kick={lvt_class['kick']} snare={lvt_class['snare']} "
          f"hihat={lvt_class['hihat']}. {len(lvt_wavs)} wavs.")
    print("All wavs readable.")


if __name__ == "__main__":
    main()
