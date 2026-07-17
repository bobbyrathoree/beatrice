#!/usr/bin/env python3
"""Build the AVP+LVT dataset manifest CSV.

Walks the AVP Personal and LVT dataset roots, produces one row per annotated
event, and writes them to a single manifest CSV. Prints per-dataset row counts.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from beatrice_ml.manifest import (build_avp_manifest, build_lvt_manifest,
                                  write_manifest)

DEFAULT_VERSION = "avplvt_v1"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--avp-root", type=Path, required=True,
                    help="AVP Personal dataset root")
    ap.add_argument("--lvt-root", type=Path, required=True,
                    help="LVT dataset root (…/LVT_Dataset)")
    ap.add_argument("--out", type=Path, default=Path("data/manifest.csv"),
                    help="output manifest CSV path")
    ap.add_argument("--version", default=DEFAULT_VERSION,
                    help="manifest/split version tag (event_id salt)")
    args = ap.parse_args()

    avp_root = args.avp_root.expanduser()
    lvt_root = args.lvt_root.expanduser()

    avp_rows = build_avp_manifest(avp_root, version=args.version)
    lvt_rows = build_lvt_manifest(lvt_root, version=args.version)
    rows = avp_rows + lvt_rows

    write_manifest(rows, args.out)

    print(f"AVP rows:  {len(avp_rows)}")
    print(f"LVT rows:  {len(lvt_rows)}")
    print(f"total:     {len(rows)}")
    print(f"wrote:     {args.out}")


if __name__ == "__main__":
    main()
