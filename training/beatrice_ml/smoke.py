"""Local end-to-end smoke driver — proves Tasks 2-6 compose before AWS spend.

Run as ``uv run python -m beatrice_ml.smoke`` from ``training/``. This is a
thin fixed-configuration driver (NOT a general CLI): it builds a small
4-participant patch cache if missing, trains the DS-CNN encoder for 3 epochs,
builds factory prototypes from the train participants, runs a deterministic
5-shot evaluation on the held-out participant, and prints a one-line JSON
summary ``{"val_ce": ..., "macro_accuracy": ...}``.
"""
import csv
import json
import logging
import tempfile
from pathlib import Path

import yaml

from .evaluate import _to_five_shot_meta
from .patches import build_patch_cache
from .prototypes import factory_prototypes, five_shot_eval
from .train import embed_all, train_encoder

# training/ (parent of beatrice_ml/)
_ROOT = Path(__file__).resolve().parent.parent

# --- fixed smoke configuration -------------------------------------------- #
CACHE = _ROOT / "data" / "patches_smoke4.npz"
CONFIG_PATH = _ROOT / "configs" / "avplvt_v1.yaml"
MANIFEST = _ROOT / "data" / "manifest.csv"

ROOTS = {
    "avp_personal": Path("~/datasets/AVP_Dataset/Personal").expanduser(),
    "lvt": Path("~/datasets/AVP-LVT/AVP-LVT_Dataset/LVT_Dataset").expanduser(),
}

CACHE_PARTICIPANTS = ["avp:1", "avp:2", "avp:3", "lvt:Bea"]
TRAIN_PARTICIPANTS = ["avp:1", "avp:2", "lvt:Bea"]
VAL_PARTICIPANTS = ["avp:3"]
TARGET_PARTICIPANT = "avp:3"

SEED = 1729
COPIES = 2
MAX_EPOCHS = 3
TAU = 5.0
DRAWS = 5

logger = logging.getLogger(__name__)


def _manifest_rows() -> list[dict]:
    with open(MANIFEST, newline="") as f:
        return list(csv.DictReader(f))


def _build_cache() -> None:
    logger.info("building smoke patch cache -> %s (participants=%s, copies=%d)",
                CACHE, CACHE_PARTICIPANTS, COPIES)
    build_patch_cache(_manifest_rows(), ROOTS, CACHE, copies=COPIES, seed=SEED,
                      participants=CACHE_PARTICIPANTS)
    logger.info("cache build complete")


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if not CACHE.exists():
        _build_cache()

    config = yaml.safe_load(CONFIG_PATH.read_text())
    # Override max_epochs to 3 without editing the yaml.
    config["train"] = {**config.get("train", {}), "max_epochs": MAX_EPOCHS}

    with tempfile.TemporaryDirectory(prefix="smoke_") as out_dir:
        ckpt = train_encoder(CACHE, TRAIN_PARTICIPANTS, VAL_PARTICIPANTS,
                             config, SEED, out_dir)
        meta = json.loads((Path(out_dir) / "meta.json").read_text())
        val_ce = meta["best_val_ce"]
        dropped = meta["val_events_dropped_unseen_syllable"]
        logger.info("val events dropped (unseen syllable): %d", dropped)

        # Factory prototypes from the TRAIN participants' embeddings.
        train_emb, train_meta = embed_all(ckpt, CACHE, TRAIN_PARTICIPANTS)
        protos = factory_prototypes(train_emb, train_meta["instrument3"],
                                    train_meta["participant"])

        # Deterministic 5-shot eval on the held-out participant.
        val_emb, val_meta = embed_all(ckpt, CACHE, VAL_PARTICIPANTS)
        fs_meta = _to_five_shot_meta(val_meta)
        result = five_shot_eval(val_emb, fs_meta, TARGET_PARTICIPANT, protos,
                                TAU, draws=DRAWS, seed=SEED)

    logger.info("per_class_recall=%s event_accuracy=%.4f",
                result["per_class_recall"], result["event_accuracy"])
    print(json.dumps({"val_ce": val_ce,
                       "macro_accuracy": result["macro_accuracy"]}))


if __name__ == "__main__":
    main()
