"""Syllable cross-entropy training loop for the DS-CNN encoder.

Library module — no CLI. The caller parses the YAML config and passes a plain
dict. Batches are drawn from the npz patch cache written by
``build_patch_cache``: train participants include augmented rows; val
participants use ORIGINALS ONLY. The syllable vocabulary is built from TRAIN
participants only (sorted for determinism); val events whose syllable is unseen
in train are dropped from the val CE (counted and logged).
"""
import json
import logging
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .model import Encoder

logger = logging.getLogger(__name__)

_META_KEYS = (
    "event_id", "dataset", "participant",
    "instrument4", "instrument3", "syllable", "role",
)


def _select_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _seed_everything(seed: int) -> np.random.Generator:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    return np.random.default_rng(seed)


def _row_mask(z, participants, originals_only: bool) -> np.ndarray:
    """Boolean mask selecting rows for the given participants. When
    ``originals_only`` is True, augmented rows are excluded."""
    keep = np.isin(z["participant"], np.asarray(list(participants), dtype=z["participant"].dtype))
    if originals_only:
        keep &= ~z["is_augmented"]
    return keep


def _patch_tensor(patches: np.ndarray) -> torch.Tensor:
    """(N, 64, F) float32 -> (N, 1, 64, F) tensor."""
    return torch.from_numpy(np.ascontiguousarray(patches, dtype=np.float32)).unsqueeze(1)


def train_encoder(cache_npz, train_participants, val_participants, config,
                  seed, out_dir) -> Path:
    """Train the encoder with syllable CE, early-stop on val CE, save
    ``encoder.pt`` (state_dict) + ``meta.json`` to ``out_dir``. Returns the
    checkpoint path."""
    rng = _seed_everything(seed)
    device = _select_device()

    model_cfg = config.get("model", {})
    train_cfg = config.get("train", {})
    channels = tuple(model_cfg.get("channels", (24, 48, 64, 96, 128)))
    embedding_dim = int(model_cfg.get("embedding_dim", 64))
    max_epochs = int(train_cfg.get("max_epochs", 50))
    lr = float(train_cfg.get("lr", 3.0e-4))
    weight_decay = float(train_cfg.get("weight_decay", 1.0e-4))
    batch_size = int(train_cfg.get("batch_size", 128))
    warmup_epochs = int(train_cfg.get("warmup_epochs", 5))
    grad_clip = float(train_cfg.get("grad_clip", 1.0))
    early_stop_patience = int(train_cfg.get("early_stop_patience", 8))

    z = np.load(cache_npz, allow_pickle=False)

    # Train rows include augmented copies; val rows are originals only.
    train_mask = _row_mask(z, train_participants, originals_only=False)
    val_mask = _row_mask(z, val_participants, originals_only=True)

    train_syllables = z["syllable"][train_mask]
    # Syllable vocabulary from TRAIN participants only, sorted for determinism.
    vocab = sorted(set(train_syllables.tolist()))
    syll_to_idx = {s: i for i, s in enumerate(vocab)}
    n_syllables = len(vocab)

    train_patches = _patch_tensor(z["patches"][train_mask])
    train_labels = torch.tensor([syll_to_idx[s] for s in train_syllables.tolist()],
                                dtype=torch.long)

    # Val events with syllables unseen in train are dropped from CE (counted).
    val_syllables = z["syllable"][val_mask]
    val_seen = np.array([s in syll_to_idx for s in val_syllables.tolist()], dtype=bool)
    n_val_dropped = int((~val_seen).sum())
    logger.info("val events with unseen syllable dropped from CE: %d (of %d)",
                n_val_dropped, int(val_mask.sum()))

    val_patches = _patch_tensor(z["patches"][val_mask][val_seen])
    val_labels = torch.tensor(
        [syll_to_idx[s] for s in val_syllables[val_seen].tolist()], dtype=torch.long)

    model = Encoder(n_syllables=n_syllables, channels=channels,
                    embedding_dim=embedding_dim).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

    def lr_scale(epoch: int) -> float:
        # Linear warm-up then cosine decay to max_epochs.
        if warmup_epochs > 0 and epoch < warmup_epochs:
            return (epoch + 1) / warmup_epochs
        denom = max(max_epochs - warmup_epochs, 1)
        progress = (epoch - warmup_epochs) / denom
        progress = min(max(progress, 0.0), 1.0)
        return 0.5 * (1.0 + math.cos(math.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(opt, lr_scale)

    use_amp = device.type == "cuda"
    n_train = train_patches.shape[0]

    val_curve: list[dict] = []
    best_val = math.inf
    best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    epochs_since_best = 0

    for epoch in range(max_epochs):
        model.train()
        perm = torch.from_numpy(rng.permutation(n_train)) if n_train else torch.empty(0, dtype=torch.long)
        train_loss_sum, train_seen = 0.0, 0
        for start in range(0, n_train, batch_size):
            idx = perm[start:start + batch_size]
            xb = train_patches[idx].to(device)
            yb = train_labels[idx].to(device)
            opt.zero_grad()
            if use_amp:
                with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                    _, logits = model(xb)
                    loss = F.cross_entropy(logits, yb)
            else:
                _, logits = model(xb)
                loss = F.cross_entropy(logits, yb)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            opt.step()
            train_loss_sum += float(loss.item()) * len(idx)
            train_seen += len(idx)
        scheduler.step()
        train_loss = train_loss_sum / train_seen if train_seen else math.nan

        # Validation (eval mode: BatchNorm uses running stats).
        model.eval()
        n_val = val_patches.shape[0]
        val_loss_sum, val_seen_n = 0.0, 0
        with torch.no_grad():
            for start in range(0, n_val, batch_size):
                xb = val_patches[start:start + batch_size].to(device)
                yb = val_labels[start:start + batch_size].to(device)
                _, logits = model(xb)
                loss = F.cross_entropy(logits, yb, reduction="sum")
                val_loss_sum += float(loss.item())
                val_seen_n += len(yb)
        val_loss = val_loss_sum / val_seen_n if val_seen_n else math.nan

        val_curve.append({
            "epoch": epoch,
            "train_ce": train_loss,
            "val_ce": val_loss,
            "lr": scheduler.get_last_lr()[0],
        })
        logger.info("epoch %d train_ce=%.4f val_ce=%.4f", epoch, train_loss, val_loss)

        improved = val_seen_n > 0 and val_loss < best_val - 1e-6
        if improved:
            best_val = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            epochs_since_best = 0
        else:
            epochs_since_best += 1
            if epochs_since_best >= early_stop_patience:
                logger.info("early stop at epoch %d (patience %d)", epoch, early_stop_patience)
                break

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ckpt_path = out / "encoder.pt"
    torch.save(best_state, ckpt_path)

    meta = {
        "syllable_vocab": vocab,
        "n_syllables": n_syllables,
        "config": config,
        "seed": seed,
        "train_participants": list(train_participants),
        "val_participants": list(val_participants),
        "val_events_dropped_unseen_syllable": n_val_dropped,
        "best_val_ce": best_val if math.isfinite(best_val) else None,
        "val_curve": val_curve,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    return ckpt_path


def embed_all(checkpoint, cache_npz, participants):
    """Load the encoder from ``checkpoint`` and run inference (eval, no grad)
    over ORIGINALS ONLY for the given participants. Returns
    ``(emb: (N, 64) np.ndarray, meta: dict of arrays)`` where meta is the npz
    metadata filtered to the same rows."""
    device = _select_device()
    z = np.load(cache_npz, allow_pickle=False)
    mask = _row_mask(z, participants, originals_only=True)

    state = torch.load(checkpoint, map_location=device, weights_only=True)
    # Recover n_syllables + embedding_dim from the saved head/proj shapes.
    n_syllables = state["syll.weight"].shape[0]
    embedding_dim = state["syll.weight"].shape[1]
    model = Encoder(n_syllables=n_syllables, embedding_dim=embedding_dim).to(device)
    model.load_state_dict(state)
    model.eval()

    patches = _patch_tensor(z["patches"][mask])
    n = patches.shape[0]
    embs: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, n, 512):
            xb = patches[start:start + 512].to(device)
            emb, _ = model(xb)
            embs.append(emb.detach().cpu().numpy())
    emb = np.concatenate(embs, axis=0) if embs else np.zeros((0, embedding_dim), dtype=np.float32)

    meta = {k: z[k][mask] for k in _META_KEYS}
    return emb.astype(np.float32), meta
