import numpy as np
from beatrice_ml.frontend import (
    resample_to_24k, mel_filterbank, logmel_patch, linear64_patch)
from beatrice_ml.frontend import SR, TAPS, BETA, CUTOFF_SCALE


def _resample_reference(x: np.ndarray, fs: int) -> np.ndarray:
    """Original scalar-loop implementation of resample_to_24k, kept here as the
    frozen reference the vectorized production version must match bit-for-bit."""
    x = np.asarray(x, dtype=np.float64)
    if fs == SR:
        return x.copy()
    ratio = SR / fs
    cutoff = CUTOFF_SCALE * min(1.0, ratio)
    n_out = int(np.floor(len(x) * ratio))
    half = TAPS // 2
    y = np.empty(n_out)
    for n in range(n_out):
        center = n / ratio
        i0 = int(np.floor(center)) - half + 1
        k = np.arange(i0, i0 + TAPS)
        t = k - center
        u = t / half
        w = np.where(np.abs(u) < 1.0,
                     np.i0(BETA * np.sqrt(np.maximum(0.0, 1.0 - u * u))) / np.i0(BETA),
                     0.0)
        h = cutoff * np.sinc(cutoff * t) * w
        s = h.sum()
        h = h / s if abs(s) > 1e-12 else h
        seg = np.where((k >= 0) & (k < len(x)), x[np.clip(k, 0, len(x) - 1)], 0.0)
        y[n] = float(seg @ h)
    return y


def test_resample_bit_identical_to_reference():
    """Vectorized resample_to_24k must be bit-identical (not just allclose) to the
    original scalar loop for every non-identity sample rate and several lengths."""
    for fs in (44100, 48000, 22050):
        for length in (2000, 2500, 3000):
            x = np.random.default_rng(fs * 1000 + length).standard_normal(length)
            fast = resample_to_24k(x, fs)
            ref = _resample_reference(x, fs)
            assert fast.shape == ref.shape
            assert np.array_equal(fast, ref), (
                f"resample mismatch at fs={fs} length={length}: "
                f"max abs diff {np.abs(fast - ref).max()}")


def test_resample_identity_at_24k():
    x = np.random.default_rng(1729).standard_normal(1000)
    assert np.array_equal(resample_to_24k(x, 24000), x)

def test_resample_preserves_tone_frequency():
    fs = 44100
    t = np.arange(fs) / fs
    x = np.sin(2 * np.pi * 440.0 * t)
    y = resample_to_24k(x, fs)
    assert abs(len(y) - 24000) <= 1
    spec = np.abs(np.fft.rfft(y[2000:18000] * np.hanning(16000)))
    peak_hz = np.argmax(spec) * 24000 / 16000
    assert abs(peak_hz - 440.0) < 3.0

def test_mel_filterbank_shape_and_coverage():
    fb = mel_filterbank()
    assert fb.shape == (64, 301)
    assert fb.min() >= 0.0
    assert (fb.sum(axis=1) > 0).all()   # every band non-empty

def test_patch_shape_and_range():
    rng = np.random.default_rng(1729)
    x = rng.standard_normal(24000)
    p = logmel_patch(x, onset_s=0.5)
    assert p.shape == (64, 13) and p.dtype == np.float32
    assert p.min() >= 0.0 and p.max() <= 1.0
    assert np.isclose(p.max(), 1.0)      # relative peak -> max bin hits 1

def test_silence_rule_all_zero():
    p = logmel_patch(np.zeros(24000), onset_s=0.5)
    assert (p == 0).all()

def test_crop_zero_pads_at_boundaries():
    x = np.random.default_rng(7).standard_normal(1200)  # 50ms of audio
    p = logmel_patch(x, onset_s=0.0)                    # pre-window off the start
    assert p.shape == (64, 13)                          # no crash, padded

def test_determinism():
    x = np.random.default_rng(2718).standard_normal(24000)
    assert np.array_equal(logmel_patch(x, 0.3), logmel_patch(x, 0.3))

def test_linear64_shape_and_range():
    rng = np.random.default_rng(1729)
    x = rng.standard_normal(24000)
    p = linear64_patch(x, onset_s=0.5)                  # default crop
    assert p.shape == (64, 13) and p.dtype == np.float32
    assert p.min() >= 0.0 and p.max() <= 1.0
    assert np.isclose(p.max(), 1.0)                     # relative peak -> max bin hits 1

def test_linear64_silence_all_zero():
    p = linear64_patch(np.zeros(24000), onset_s=0.5)
    assert (p == 0).all()
