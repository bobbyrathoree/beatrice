"""Patch extraction, augmentation, and npz patch cache.

librosa is used ONLY in this module, and ONLY for augmentation
(pitch_shift / time_stretch). The frontend (logmel_patch etc.) stays pure
numpy — the original (non-augmented) patch is never routed through librosa.
"""
import logging
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from . import frontend
from .frontend import SR, logmel_patch, resample_to_24k

logger = logging.getLogger(__name__)

# Frontend patch functions, resolved by name inside each worker so the choice
# survives a spawn start method (a parent runtime module-global swap would NOT
# be inherited by spawned children — see ablate._build_variant_cache).
_FRONTENDS = {
    "mel64": "logmel_patch",
    "linear64": "linear64_patch",
}


def _resolve_frontend(kind: str):
    """Resolve a frontend kind ("mel64"/"linear64") to its patch function."""
    try:
        return getattr(frontend, _FRONTENDS[kind])
    except KeyError:
        raise ValueError(
            f"unknown frontend {kind!r}; expected one of {sorted(_FRONTENDS)}")

# Augmentation segment window around the onset.
_PRE_SEG_S = 0.2
_POST_SEG_S = 0.7

_recording_cache: dict[tuple[str, str], np.ndarray] = {}


def load_recording_24k(roots: dict[str, Path], dataset: str, rel_path: str) -> np.ndarray:
    """Resolve the root by dataset key, soundfile read -> mono mean -> resample
    to 24 kHz. Cached per (dataset, rel_path) in-process."""
    key = (dataset, rel_path)
    cached = _recording_cache.get(key)
    if cached is not None:
        return cached
    root = Path(roots[dataset])
    x, fs = sf.read(str(root / rel_path), always_2d=False)
    x = np.asarray(x, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x24 = resample_to_24k(x, fs)
    _recording_cache[key] = x24
    return x24


def augment_event(x24: np.ndarray, onset_s: float,
                  rng: np.random.Generator) -> tuple[np.ndarray, float]:
    """Extract the wide segment [onset-0.2s, onset+0.7s] (start clamped to 0),
    apply pitch shift U(-1.5, 1.5) st and time stretch U(0.8, 1.2) in an
    rng-chosen order, then add onset jitter U(-0.02, 0.02)s. Returns the
    augmented segment and the adjusted onset position within the segment.

    Deterministic given the same seeded rng. When time stretch (rate r) is
    applied, the onset-within-segment scales by 1/r; jitter is added last.
    """
    x24 = np.asarray(x24, dtype=np.float64)
    seg_start_s = max(onset_s - _PRE_SEG_S, 0.0)
    seg_end_s = onset_s + _POST_SEG_S
    lo = int(round(seg_start_s * SR))
    hi = min(int(round(seg_end_s * SR)), len(x24))
    seg = np.ascontiguousarray(x24[lo:hi], dtype=np.float64)
    onset_in_seg = onset_s - seg_start_s

    # Draw all randomness up front, in a fixed order, so the result is
    # fully determined by the seeded rng.
    n_steps = float(rng.uniform(-1.5, 1.5))
    rate = float(rng.uniform(0.8, 1.2))
    stretch_first = bool(rng.integers(0, 2))
    jitter = float(rng.uniform(-0.02, 0.02))

    def _pitch(y):
        return librosa.effects.pitch_shift(y, sr=SR, n_steps=n_steps)

    def _stretch(y):
        nonlocal onset_in_seg
        onset_in_seg = onset_in_seg / rate  # position scales by 1/rate
        return librosa.effects.time_stretch(y, rate=rate)

    if stretch_first:
        seg = _pitch(_stretch(seg))
    else:
        seg = _stretch(_pitch(seg))

    onset_in_seg += jitter  # jitter added last
    seg_dur_s = len(seg) / SR
    onset_in_seg = float(np.clip(onset_in_seg, 0.0, seg_dur_s))
    return seg.astype(np.float64), onset_in_seg


def _capped(x24: np.ndarray, onset_s: float, next_onset_s: float) -> np.ndarray:
    """Zero out samples at/after next_onset (i.e. crop samples past
    next_onset - onset relative to the onset), only when next_onset >= 0."""
    if next_onset_s < 0:
        return x24
    cut = int(round(next_onset_s * SR))
    if cut >= len(x24):
        return x24
    x = x24.copy()
    x[cut:] = 0.0
    return x


_META_KEYS = ("event_id", "dataset", "participant",
              "instrument4", "instrument3", "syllable", "role")


def _process_recording_chunk(chunk_rows, roots, crop, copies, seed,
                             cap_next_onset, frontend_kind):
    """Build all patches for one recording's contiguous block of manifest rows.

    Runs in a worker process (or in-process for workers=1). The recording is
    loaded/resampled once (per-worker in-process cache). Returns
    ``(patches, meta, is_augmented)`` where meta is a dict of per-event lists,
    all in the input row order — so the caller can reassemble the full cache in
    manifest order by chunk index regardless of completion order.
    """
    patch_fn = _resolve_frontend(frontend_kind)
    pre_s, post_s = crop

    patches: list[np.ndarray] = []
    meta: dict[str, list] = {k: [] for k in _META_KEYS}
    is_augmented: list[bool] = []

    for row in chunk_rows:
        ds = row["dataset"]
        onset = float(row["onset_seconds"])
        next_onset = float(row["next_onset_seconds"])
        x24 = load_recording_24k(roots, ds, row["path"])

        def _record(patch, augmented):
            patches.append(patch)
            meta["event_id"].append(row["event_id"])
            meta["dataset"].append(ds)
            meta["participant"].append(row["participant"])
            meta["instrument4"].append(row["instrument4"])
            meta["instrument3"].append(row["instrument3"])
            meta["syllable"].append(row["syllable"])
            meta["role"].append(row["role"])
            is_augmented.append(augmented)

        # Original: pure numpy frontend.
        src = _capped(x24, onset, next_onset) if cap_next_onset else x24
        _record(patch_fn(src, onset, pre_s, post_s), False)

        # Augmented copies: deterministic per (seed, event_id, copy index).
        # The rng is keyed on (seed, event_id, copy) so parallelism across
        # recordings cannot perturb any draw — it is safe by construction.
        for c in range(copies):
            rng = np.random.default_rng([seed, int(row["event_id"], 16), c])
            seg, adj_onset = augment_event(x24, onset, rng)
            _record(patch_fn(seg, adj_onset, pre_s, post_s), True)

    return patches, meta, is_augmented


def _chunk_by_recording(manifest_rows, keep):
    """Split (participant-filtered) rows into contiguous per-recording chunks,
    preserving manifest order. Rows are contiguous by (dataset, path)."""
    chunks: list[list[dict]] = []
    current_key = None
    for row in manifest_rows:
        if keep is not None and row["participant"] not in keep:
            continue
        key = (row["dataset"], row["path"])
        if key != current_key:
            chunks.append([])
            current_key = key
        chunks[-1].append(row)
    return chunks


def build_patch_cache(manifest_rows, roots, out_npz, crop=(0.025, 0.125),
                      copies=10, seed=1729, participants=None,
                      cap_next_onset=False, workers=None,
                      frontend_kind="mel64") -> None:
    """Build the npz patch cache: one original + `copies` augmented patches per
    event. Originals go through the pure-numpy frontend; augmented copies use
    librosa. `crop` = (pre_s, post_s) threads through to the frontend.
    `participants=None` uses all rows; otherwise filter to the listed
    namespaced participant IDs. When `cap_next_onset` is True, crop samples past
    next_onset - onset are zeroed before the STFT (originals only).

    `frontend_kind` selects the patch function ("mel64" -> logmel_patch,
    "linear64" -> linear64_patch); it is passed explicitly to every worker so the
    choice survives a spawn start method (a parent module-global swap would not).

    `workers` controls the process pool: None -> os.cpu_count(); 1 keeps the old
    in-process (no pool) code path. Work is grouped by recording so each worker
    loads/resamples a recording once. Results are assembled DETERMINISTICALLY in
    manifest row order (by input chunk index) regardless of completion order, so
    the npz is byte-identical to the serial build.
    """
    keep = set(participants) if participants is not None else None
    chunks = _chunk_by_recording(manifest_rows, keep)
    n_chunks = len(chunks)
    n_workers = os.cpu_count() if workers is None else int(workers)

    # Per-chunk results, indexed to preserve manifest order.
    results: list[tuple | None] = [None] * n_chunks

    def _args(idx):
        return (chunks[idx], roots, crop, copies, seed, cap_next_onset,
                frontend_kind)

    if n_workers <= 1 or n_chunks <= 1:
        # In-process path (keeps the original serial code path alive).
        for i in range(n_chunks):
            results[i] = _process_recording_chunk(*_args(i))
            logger.info("cache: %d/%d recordings", i + 1, n_chunks)
    else:
        with ProcessPoolExecutor(max_workers=n_workers) as pool:
            futures = {pool.submit(_process_recording_chunk, *_args(i)): i
                       for i in range(n_chunks)}
            done = 0
            from concurrent.futures import as_completed
            for fut in as_completed(futures):
                i = futures[fut]
                results[i] = fut.result()
                done += 1
                logger.info("cache: %d/%d recordings", done, n_chunks)

    # Reassemble in manifest (chunk-index) order.
    patches: list[np.ndarray] = []
    meta: dict[str, list] = {k: [] for k in _META_KEYS}
    is_augmented: list[bool] = []
    for res in results:
        chunk_patches, chunk_meta, chunk_aug = res
        patches.extend(chunk_patches)
        for k in _META_KEYS:
            meta[k].extend(chunk_meta[k])
        is_augmented.extend(chunk_aug)

    out = Path(out_npz)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        out,
        patches=np.stack(patches).astype(np.float32) if patches
        else np.zeros((0, 64, 0), dtype=np.float32),
        event_id=np.array(meta["event_id"], dtype="U"),
        dataset=np.array(meta["dataset"], dtype="U"),
        participant=np.array(meta["participant"], dtype="U"),
        instrument4=np.array(meta["instrument4"], dtype="U"),
        instrument3=np.array(meta["instrument3"], dtype="U"),
        syllable=np.array(meta["syllable"], dtype="U"),
        role=np.array(meta["role"], dtype="U"),
        is_augmented=np.array(is_augmented, dtype=bool),
    )
