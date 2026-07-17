import numpy as np
from beatrice_ml.patches import augment_event, build_patch_cache

def test_augment_bounds_and_determinism():
    rng1, rng2 = np.random.default_rng(1729), np.random.default_rng(1729)
    x = np.random.default_rng(3).standard_normal(24000).astype(np.float64)
    seg1, on1 = augment_event(x, 0.5, rng1)
    seg2, on2 = augment_event(x, 0.5, rng2)
    assert np.array_equal(seg1, seg2) and on1 == on2   # seeded => identical
    assert 0.0 <= on1 <= 0.9 * 1.2 + 0.02              # onset stays in segment

def test_cache_roundtrip(tmp_path, synthetic_manifest_and_audio):
    rows, roots = synthetic_manifest_and_audio  # fixture: 2 participants, 3 events each
    out = tmp_path / "cache.npz"
    build_patch_cache(rows, roots, out, copies=2, seed=1729)
    z = np.load(out, allow_pickle=False)
    assert z["patches"].shape[0] == 6 * 3               # (1 orig + 2 aug) * 6 events
    assert z["patches"].shape[1:] == (64, 13)
    assert set(z["is_augmented"].tolist()) == {False, True}
    orig = z["patches"][~z["is_augmented"]]
    assert (orig.max(axis=(1, 2)) > 0.99).all()         # relative peak present


def test_cache_parallel_matches_serial(tmp_path, synthetic_manifest_and_audio):
    """The multiprocessing path (workers=2) must produce byte-for-byte identical
    arrays to the serial (workers=1) path — deterministic manifest ordering."""
    rows, roots = synthetic_manifest_and_audio
    serial = tmp_path / "serial.npz"
    parallel = tmp_path / "parallel.npz"
    build_patch_cache(rows, roots, serial, copies=2, seed=1729, workers=1)
    build_patch_cache(rows, roots, parallel, copies=2, seed=1729, workers=2)
    zs = np.load(serial, allow_pickle=False)
    zp = np.load(parallel, allow_pickle=False)
    assert set(zs.files) == set(zp.files)
    for k in zs.files:
        assert np.array_equal(zs[k], zp[k]), f"array {k} differs serial vs parallel"


def test_cache_frontend_kind_linear64(tmp_path, synthetic_manifest_and_audio):
    """frontend_kind='linear64' routes through linear64_patch (same shape)."""
    rows, roots = synthetic_manifest_and_audio
    out = tmp_path / "lin.npz"
    build_patch_cache(rows, roots, out, copies=1, seed=1729,
                      workers=2, frontend_kind="linear64")
    z = np.load(out, allow_pickle=False)
    assert z["patches"].shape == (6 * 2, 64, 13)
