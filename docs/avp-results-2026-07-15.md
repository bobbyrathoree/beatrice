# AVP Benchmark Results

Dataset: AVP v4, Zenodo record 5036529 (merged Personal+Fixed per participant)

- Participants: **28**
- Annotated utterances: **9777**
- Utterances scored (held-out eval set): **9357**
- Calibration per class per participant: **5**
- Feature window: **150 ms**
- Unknown-label rows skipped: **1**
- Open-hat (`hho`) utterances in eval, folded into HihatNoise: **2204**

## Overall (participant-wise mean accuracy)

| Classifier | Accuracy |
|---|---|
| Heuristic (no calibration) | 65.8% |
| Per-participant calibrated (kNN, k=5) | 60.2% |
| Gaussian MFCC model, user-agnostic (LOPO) | 79.7% |
| Gaussian MFCC model + MAP calibration (LOPO, tau=10) | **81.6%** |

## Per-class precision / recall

| Class | Heuristic P | Heuristic R | kNN P | kNN R | Gaussian P | Gaussian R |
|---|---|---|---|---|---|---|
| kd → BilabialPlosive | 76.2% | 72.4% | 73.4% | 85.4% | 91.1% | 85.5% |
| hhc/hho → HihatNoise | 67.1% | 85.2% | 68.9% | 54.7% | 81.2% | 87.3% |
| sd → Click | 43.8% | 20.8% | 35.0% | 42.1% | 70.8% | 65.8% |
| (none) → HumVoiced | 0.0% | — | — | — | 0.0% | — |

## Protocol

Participant-wise accuracy (Delgado et al.): the mean over participants of each participant's per-utterance accuracy. All classifiers are scored on the same held-out eval set — every utterance after the first N per class per participant. Calibration examples come from the same participant but are excluded from that participant's eval set. The Gaussian rows are leave-one-participant-out: each participant is scored by a model fitted only on the other 27 participants (their own voice never trains their factory model), then MAP-adapted from their calibration samples. Open hi-hat (`hho`) has no Beatrice class and is folded into HihatNoise (counted above).

Dataset: AVP "Amateur Vocal Percussion" (Delgado et al.), Zenodo, CC-BY.
