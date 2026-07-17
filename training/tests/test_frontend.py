import numpy as np
from beatrice_ml.frontend import resample_to_24k, mel_filterbank, logmel_patch

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
