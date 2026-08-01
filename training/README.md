# beatrice-ml

Training pipeline for a learned beatbox-event classifier — the attempt to replace
Beatrice's shipping Gaussian classifier with a CNN embedding model.

**Status: evaluated, failed its pre-registered gate, not shipped.** This tree is
public because the negative result is the useful part. Nothing here runs in the
app; the shipping classifier is the ~2 KB Gaussian model described in the
[main README](../README.md#benchmark).

## Why this exists

Beatrice classifies four mouth sounds (kick / snare / hi-hat / hum). The shipped
hybrid Gaussian scores **81.6%** participant-wise on the AVP benchmark, against a
published personalized-CNN SOTA of ≈0.90. This package was the attempt to close
that gap with a small learned model that adapts to a user from 5 labeled examples.

## The gate (set before training, not after)

A pre-registered bar the model had to clear to replace the Gaussian:

| Criterion | Threshold |
|---|---|
| Pooled 3-seed mean 5-shot macro accuracy | ≥ 0.900 |
| Per-seed minimum | ≥ 0.880 |
| Worst per-class recall | ≥ 0.800 |
| Paired bootstrap lower-95 vs Gaussian | > 0 |

Committing to the numbers in advance is the point: it removes the temptation to
redefine success after seeing the results.

## Results

Two crop candidates survived the ablation stage and both went through the gate.

| Metric (threshold) | crop_A (25 ms pre + 125 ms) | crop_C (300 ms capped) |
|---|---|---|
| Pooled 5-shot macro (≥ 0.900) | 0.808 ❌ | **0.828** ❌ |
| Per-seed min (≥ 0.880) | 0.801 ❌ | 0.818 ❌ |
| Worst class recall (≥ 0.800) | snare 0.701 ❌ | snare 0.732 ❌ |
| Bootstrap lower-95 vs Gaussian (> 0) | −0.046 ❌ | **+0.045** ✅ |

Matched Gaussian on the same folds and support draws: **0.811**.

Protocol: nested out-of-fold over 40 development participants (24 AVP + 16 LVT),
5 outer folds × 3 seeds, adaptation strength tuned only on inner folds, 5-shot
support from isolated recordings, queries from improvisation events.

Input-crop ablation (mean inner 5-shot macro, percentage points):

| Variant | Crop (pre, post) | Cap at next onset | Frontend | Score |
|---|---|---|---|---|
| A | (0.025, 0.125) | no | mel64 | 77.10 |
| B | (0, 0.150) | no | mel64 | 78.05 |
| **C** | (0, 0.300) | yes | mel64 | **81.00** |
| D | (0, 0.560) | yes | mel64 | 76.48 |
| A_linear64 | (0.025, 0.125) | no | linear64 | 73.54 |

### Reading the result

- **The gate failed unambiguously** (0.828 vs 0.900), so the Gaussian stays
  shipped. The CNN's edge over it (+1.7 pp, bootstrap-supported) is real but far
  short of what would justify replacing a 2 KB model with a neural net.
- **Snare is the bottleneck** (0.73 recall vs kick 0.94). LVT provides only 4
  isolated snare events per participant, and snare imitations genuinely overlap
  hi-hats in timbre. Any next iteration should attack snare specifically.
- **The held-out test set was never opened.** Four AVP and four LVT participants
  (`avp:9/11/19/24`, `lvt:AFR/Cra/Isa/Mar`) were locked before training and the
  lock is enforced in code. A model that fails on development data does not get
  to go looking for a kinder number.
- **The bar may be the wrong yardstick.** The published ≈0.899 involves
  participant-specific fine-tuning of a much larger model on a different split —
  not 5-shot prototype adaptation under nested OOF. The shipping Gaussian scores
  0.811 under this harder protocol. Moving a pre-registered bar after seeing the
  results is a judgement call, so the bar and the failure both stand as recorded.
- **Cost:** ~$5.65 of GPU time across three runs (L40S).
- **Crop C at 300 ms implies ~300 ms classification latency** in any live path,
  which matters for [Jam Mode](../README.md#jam-mode) but not the offline pipeline.

## What's in here

| Module | Role |
|---|---|
| `manifest.py` | Dataset inventory over AVP + AVP-LVT, participant grouping |
| `frontend.py` | Feature frontend with a bit-exactness contract vs the Rust DSP |
| `patches.py` | Parallel patch-cache builder (deterministic assembly) |
| `model.py` | ~34K-param depthwise-separable CNN, L2-normalized embedding |
| `train.py` | Episodic training loop + embedding extraction |
| `prototypes.py` | 5-shot cosine-prototype adaptation |
| `evaluate.py` | Nested OOF, matched Gaussian baseline, gate report, paired bootstrap |
| `ablate.py` / `baseline.py` | The two experiment drivers |
| `infra/` | EC2 GPU recipe with cost safety (self-terminating instances) |

The frontend carries **bit-exactness parity tests** against the Rust
implementation — a learned model is only as trustworthy as its guarantee that
training and inference see identical features.

## Local setup

```bash
uv sync
uv run pytest -v     # 49 tests
```

The datasets are not bundled (large, separately licensed). AVP comes from Zenodo;
AVP-LVT audio was obtained from its authors.

## GPU runs

See [`infra/`](infra/). Instances self-terminate on a timer and on exit — an
abandoned GPU box is the expensive failure mode, so cost safety is installed
before any network call. Set `BEATRICE_S3_BUCKET` to your own bucket.
