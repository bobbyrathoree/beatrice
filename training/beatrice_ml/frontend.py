import numpy as np

SR = 24000
TAPS = 32
BETA = 8.6
CUTOFF_SCALE = 0.94
N_FFT = 600
HOP = 240
N_MELS = 64
FMIN = 0.0
FMAX = 12000.0
LOG_FLOOR_DB = -50.0
SILENCE_EMAX = 1e-12

def resample_to_24k(x: np.ndarray, fs: int) -> np.ndarray:
    """32-tap Kaiser-windowed sinc, beta=8.6, cutoff 0.94*min(1, 24000/fs),
    per-output DC normalization, source coordinate = n*fs/24000.

    Frozen input contract (future Rust parity). This is a vectorized rewrite of
    the original per-output scalar loop that is BIT-IDENTICAL to it: the (n_out,
    32) index/coefficient matrices are built with the same formulas in the same
    dtype, and each output is the same per-row ``seg @ h`` dot product the loop
    computed (numpy's einsum/matmul use pairwise/blocked summation that is NOT
    bit-identical, so the output is assembled row-by-row with ``@`` over the
    precomputed arrays — see ``test_frontend._resample_reference``).
    """
    x = np.asarray(x, dtype=np.float64)
    if fs == SR:
        return x.copy()
    ratio = SR / fs
    cutoff = CUTOFF_SCALE * min(1.0, ratio)
    n_out = int(np.floor(len(x) * ratio))
    half = TAPS // 2

    center = np.arange(n_out, dtype=np.float64) / ratio      # exact source coords
    i0 = np.floor(center).astype(np.int64) - half + 1
    k = i0[:, None] + np.arange(TAPS, dtype=np.int64)[None, :]  # (n_out, 32)
    t = k - center[:, None]                                  # in [-16, 16)
    u = t / half
    # Kaiser window, np.i0 vectorized over all rows at once.
    w = np.where(np.abs(u) < 1.0,
                 np.i0(BETA * np.sqrt(np.maximum(0.0, 1.0 - u * u))) / np.i0(BETA),
                 0.0)
    h = cutoff * np.sinc(cutoff * t) * w                     # (n_out, 32)
    s = h.sum(axis=1)
    norm = np.abs(s) > 1e-12
    # Per-output DC normalization; rows with ~zero sum keep h unchanged.
    h[norm] = h[norm] / s[norm, None]
    seg = np.where((k >= 0) & (k < len(x)), x[np.clip(k, 0, len(x) - 1)], 0.0)

    # Same-ordered per-row dot product as the original ``float(seg @ h)`` loop
    # (bit-identical; einsum/matmul reductions are not — verified in tests).
    y = np.empty(n_out)
    for n in range(n_out):
        y[n] = seg[n] @ h[n]
    return y

def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + np.asarray(f, dtype=np.float64) / 700.0)

def _mel_to_hz(m):
    return 700.0 * (10.0 ** (np.asarray(m, dtype=np.float64) / 2595.0) - 1.0)

def mel_filterbank() -> np.ndarray:
    """64 HTK triangles, fmin=0, fmax=12000, NO area normalization."""
    pts = _mel_to_hz(np.linspace(_hz_to_mel(FMIN), _hz_to_mel(FMAX), N_MELS + 2))
    bins = np.fft.rfftfreq(N_FFT, d=1.0 / SR)   # 301 bins
    fb = np.zeros((N_MELS, bins.size))
    for m in range(N_MELS):
        lo, c, hi = pts[m], pts[m + 1], pts[m + 2]
        up = (bins - lo) / (c - lo)
        dn = (hi - bins) / (hi - c)
        fb[m] = np.maximum(0.0, np.minimum(up, dn))
    return fb

_FB = mel_filterbank()
_WIN = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(N_FFT) / N_FFT)  # periodic Hann

def crop_samples(x24: np.ndarray, onset_s: float, pre_s: float, post_s: float) -> np.ndarray:
    n = int(round((pre_s + post_s) * SR))
    start = int(round((onset_s - pre_s) * SR))
    out = np.zeros(n)
    lo, hi = max(start, 0), min(start + n, len(x24))
    if hi > lo:
        out[lo - start:hi - start] = x24[lo:hi]
    return out

N_LINEAR = 64  # first 64 rFFT power bins for the linear64 frontend variant


def _framed_power(crop: np.ndarray) -> tuple[np.ndarray, int]:
    """Windowed STFT power spectrum of a raw crop.

    Returns ``(power (n_frames, 301), n_frames)`` — the shared front half of both
    the mel and linear patch pipelines.
    """
    n_frames = (len(crop) - N_FFT) // HOP + 1
    frames = np.stack([crop[i * HOP:i * HOP + N_FFT] * _WIN for i in range(n_frames)])
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2          # (n_frames, 301)
    return power, n_frames


def _normalize_patch(energy: np.ndarray, n_bins: int, n_frames: int) -> np.ndarray:
    """Relative-peak / -50 dB log normalization shared by both frontends.

    ``energy`` is (n_frames, n_bins); returns a (n_bins, n_frames) float32 patch
    in [0, 1], or all-zeros when the crop is silent (max energy below floor).
    """
    emax = energy.max() if energy.size else 0.0
    if emax < SILENCE_EMAX:
        return np.zeros((n_bins, n_frames), dtype=np.float32)
    db = np.clip(10.0 * np.log10(np.maximum(energy, 1e-12) / emax), LOG_FLOOR_DB, 0.0)
    return ((db - LOG_FLOOR_DB) / -LOG_FLOOR_DB).T.astype(np.float32)  # (n_bins, n_frames)


def logmel_patch(x24: np.ndarray, onset_s: float,
                 pre_s: float = 0.025, post_s: float = 0.125) -> np.ndarray:
    crop = crop_samples(np.asarray(x24, dtype=np.float64), onset_s, pre_s, post_s)
    power, n_frames = _framed_power(crop)
    mel = power @ _FB.T                                        # (n_frames, 64)
    return _normalize_patch(mel, N_MELS, n_frames)


def linear64_patch(x24: np.ndarray, onset_s: float,
                   pre_s: float = 0.025, post_s: float = 0.125) -> np.ndarray:
    """First 64 rFFT power bins with the SAME relative-peak / -50 dB
    normalization pipeline as ``logmel_patch`` (a distinct frontend, not a flag).

    Returns a ``(64, n_frames)`` float32 patch in [0, 1], all-zeros on silence.
    """
    crop = crop_samples(np.asarray(x24, dtype=np.float64), onset_s, pre_s, post_s)
    power, n_frames = _framed_power(crop)
    lin = power[:, :N_LINEAR]                                 # (n_frames, 64)
    return _normalize_patch(lin, N_LINEAR, n_frames)
