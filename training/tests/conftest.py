import hashlib

import numpy as np
import pytest
import soundfile as sf

SR = 24000


def _sine_burst_recording(onsets, sr=SR, total_s=2.5, burst_s=0.2, freq=440.0):
    """Silence with a short sine burst centered on each onset (burst covers the
    logmel crop window so the normalized patch peak lands at ~1.0)."""
    x = np.zeros(int(round(total_s * sr)), dtype=np.float64)
    for on in onsets:
        start = int(round((on - 0.05) * sr))
        n = int(round(burst_s * sr))
        idx = np.arange(n)
        burst = 0.8 * np.sin(2 * np.pi * freq * idx / sr)
        lo, hi = max(start, 0), min(start + n, len(x))
        if hi > lo:
            x[lo:hi] = burst[lo - start:hi - start]
    return x


def _rows_for(dataset, participant, rel_path, recording, role, onsets,
              instrument4, instrument3, syllable):
    rows = []
    ordered = sorted(onsets)
    for i, on in enumerate(ordered):
        nxt = ordered[i + 1] if i + 1 < len(ordered) else -1.0
        key = f"{dataset}|{rel_path}|{i}|{on:.9f}"
        rows.append({
            "event_id": hashlib.sha256(key.encode()).hexdigest()[:16],
            "dataset": dataset,
            "participant": participant,
            "recording": recording,
            "role": role,
            "onset_seconds": on,
            "next_onset_seconds": nxt,
            "instrument4": instrument4,
            "instrument3": instrument3,
            "onset_phone": "p",
            "coda_phone": "x",
            "syllable": syllable,
            "path": rel_path,
        })
    return rows


@pytest.fixture
def synthetic_manifest_and_audio(tmp_path):
    """Two participants (one avp, one lvt) with one wav each, three sine-burst
    events per participant. Returns (rows, {dataset_key: root})."""
    avp_root = tmp_path / "avp"
    lvt_root = tmp_path / "lvt"
    avp_rel = "Participant_1/P1_Kick_Personal.wav"
    lvt_rel = "Frase/FooP3.wav"
    (avp_root / "Participant_1").mkdir(parents=True)
    (lvt_root / "Frase").mkdir(parents=True)

    avp_onsets = [0.30, 0.90, 1.50]
    lvt_onsets = [0.40, 1.00, 1.60]
    sf.write(avp_root / avp_rel, _sine_burst_recording(avp_onsets), SR)
    sf.write(lvt_root / lvt_rel, _sine_burst_recording(lvt_onsets, freq=660.0), SR)

    rows = []
    rows += _rows_for("avp_personal", "avp:1", avp_rel, "Kick", "isolated",
                      avp_onsets, "kd", "kick", "p_x")
    rows += _rows_for("lvt", "lvt:Foo", lvt_rel, "Frase", "isolated",
                      lvt_onsets, "kick", "kick", "p_x")
    return rows, {"avp_personal": avp_root, "lvt": lvt_root}
