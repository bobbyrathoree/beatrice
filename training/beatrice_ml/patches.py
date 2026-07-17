"""Patch extraction, augmentation, and npz patch cache.

librosa is used ONLY in this module, and ONLY for augmentation
(pitch_shift / time_stretch). The frontend (logmel_patch etc.) stays pure
numpy — the original (non-augmented) patch is never routed through librosa.
"""
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from .frontend import SR, logmel_patch, resample_to_24k

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


def build_patch_cache(manifest_rows, roots, out_npz, crop=(0.025, 0.125),
                      copies=10, seed=1729, participants=None,
                      cap_next_onset=False) -> None:
    """Build the npz patch cache: one original + `copies` augmented patches per
    event. Originals go through the pure-numpy frontend; augmented copies use
    librosa. `crop` = (pre_s, post_s) threads through to logmel_patch.
    `participants=None` uses all rows; otherwise filter to the listed
    namespaced participant IDs. When `cap_next_onset` is True, crop samples past
    next_onset - onset are zeroed before the STFT (originals only).
    """
    pre_s, post_s = crop
    keep = set(participants) if participants is not None else None

    patches: list[np.ndarray] = []
    event_id, dataset, participant = [], [], []
    instrument4, instrument3, syllable, role = [], [], [], []
    is_augmented: list[bool] = []

    for row in manifest_rows:
        if keep is not None and row["participant"] not in keep:
            continue
        ds = row["dataset"]
        onset = float(row["onset_seconds"])
        next_onset = float(row["next_onset_seconds"])
        x24 = load_recording_24k(roots, ds, row["path"])

        def _record(patch, augmented):
            patches.append(patch)
            event_id.append(row["event_id"])
            dataset.append(ds)
            participant.append(row["participant"])
            instrument4.append(row["instrument4"])
            instrument3.append(row["instrument3"])
            syllable.append(row["syllable"])
            role.append(row["role"])
            is_augmented.append(augmented)

        # Original: pure numpy frontend.
        src = _capped(x24, onset, next_onset) if cap_next_onset else x24
        _record(logmel_patch(src, onset, pre_s, post_s), False)

        # Augmented copies: deterministic per (seed, event_id, copy index).
        for c in range(copies):
            rng = np.random.default_rng([seed, int(row["event_id"], 16), c])
            seg, adj_onset = augment_event(x24, onset, rng)
            _record(logmel_patch(seg, adj_onset, pre_s, post_s), True)

    out = Path(out_npz)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        out,
        patches=np.stack(patches).astype(np.float32) if patches
        else np.zeros((0, 64, 0), dtype=np.float32),
        event_id=np.array(event_id, dtype="U"),
        dataset=np.array(dataset, dtype="U"),
        participant=np.array(participant, dtype="U"),
        instrument4=np.array(instrument4, dtype="U"),
        instrument3=np.array(instrument3, dtype="U"),
        syllable=np.array(syllable, dtype="U"),
        role=np.array(role, dtype="U"),
        is_augmented=np.array(is_augmented, dtype=bool),
    )
