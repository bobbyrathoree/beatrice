# Beatrice EC2 training infra

One-shot GPU training runs on EC2. You launch a run, poll it, and it
**self-terminates** — there is nothing long-lived to forget about and pay for.

## Frugality rules (hard constraints)

These are non-negotiable and are enforced by the scripts:

- **On-demand `g6e.2xlarge`, `us-west-2` only.** No other type/region.
- **`--instance-initiated-shutdown-behavior terminate`** — any `poweroff`
  (whether the run finishes, crashes, or the timer fires) *terminates* the
  instance, releasing the GPU and the EBS volume.
- **12-hour self-terminate timer**, installed by `bootstrap.sh` **before any
  work starts**. Belt-and-suspenders: even if the run hangs, the box dies at
  `OnBootSec=12h`.
- **Zero-ingress security group** (`beatrice-training-sg`). No SSH, no open
  ports. Access, if ever needed, is via SSM Session Manager only (the instance
  role has `AmazonSSMManagedInstanceCore`).
- **Every instance tagged `Project=beatrice`** so `terminate.sh` / `status.sh`
  can always find and reap it.
- `terminate.sh` is idempotent and lists `Project=beatrice` instances **before
  and after** so you can see exactly what it did.

If you ever suspect a stray instance: run `terminate.sh`. It is a safe no-op
when nothing is running.

## The pieces

| Script | Role |
| --- | --- |
| `launch.sh` | Idempotently provisions AWS resources, packs+uploads code/data, renders bootstrap, launches one instance. |
| `bootstrap.sh` | User-data template (runs as root on the instance). Pulls code+data, installs the self-terminate timer, runs the command, syncs results to S3, powers off. |
| `status.sh` | Lists `Project=beatrice` instances + the newest object under `runs/` (the live run's heartbeat). |
| `logs.sh` | `s3 cp` a run's `train.log` and `tail -100`. |
| `terminate.sh` | Reaps all `Project=beatrice` instances. Idempotent; safe to run anytime. |

All scripts export `AWS_PROFILE=default` + `us-west-2` at the top and are
shellcheck-clean.

## S3 layout

Bucket: `beatrice-ml-387391740137-usw2`

```
s3://$BUCKET/
  code/beatrice-training.tar.gz   # git archive HEAD training/  (has training/ prefix)
  data/manifest.csv               # the event manifest
  data/audio.tar                  # BOTH dataset roots: avp_personal/ + lvt/  (~1-2 GB)
  runs/<run-id>/
    cmd.sh                        # the command launch.sh was given
    train.log                     # stdout+stderr of the run (synced every 10 min)
    exit_code.txt                 # the run's exit code
    ...                           # anything else the run writes into runs/<run-id>/
```

## AWS resources (all created idempotently by `launch.sh`)

- S3 bucket (create-if-absent).
- IAM role `beatrice-training` — trust policy for `ec2.amazonaws.com`;
  `AmazonSSMManagedInstanceCore` attached; inline policy `beatrice-s3` scoped to
  this bucket only (`ListBucket` on the bucket, `GetObject`/`PutObject` on
  `/*`).
- Instance profile `beatrice-training` wrapping that role.
- Security group `beatrice-training-sg` — **no ingress rules** ever added.

Re-running `launch.sh` reuses existing resources (get-if-present,
create-if-absent), so it is safe to run repeatedly.

## Config override on EC2 (design choice)

The checked-in `configs/avplvt_v1.yaml` points `data.avp_root` /
`data.lvt_root` at the **local** dataset paths
(`~/datasets/AVP_Dataset/Personal`, etc.). On EC2 the data lives elsewhere.

`data/audio.tar` is built with both dataset roots as **top-level directories**
`avp_personal/` and `lvt/`. `bootstrap.sh` untars it into `~/datasets_ec2/`,
yielding `~/datasets_ec2/avp_personal` and `~/datasets_ec2/lvt`.

**Chosen mechanism: sed-patch a copy of the config.** `bootstrap.sh` copies the
checked-in yaml to `configs/avplvt_v1.ec2.yaml`, rewriting just the two
`*_root:` lines to the untarred locations:

```
avp_root: /root/datasets_ec2/avp_personal
lvt_root: /root/datasets_ec2/lvt
```

Everything else (frontend params, seeds, model, ...) is inherited verbatim, so
the two configs can never drift. **Point your `--cmd` at
`configs/avplvt_v1.ec2.yaml`** on EC2 (see the launch example below). The sed
uses POSIX `[[:space:]]` so it behaves identically under GNU and BSD sed.

(Alternative considered: writing a tiny yaml overlay and merging at load time.
Rejected — the training code loads a single yaml with `yaml.safe_load` and has
no merge step, so a patched copy is the smallest, most transparent change.)

## `audio.tar` caching (design choice)

The audio tar is ~1-2 GB, so `launch.sh` **skips rebuilding/uploading it if
`data/audio.tar` already exists in S3**. Pass `--refresh-data` to force a
rebuild+upload (e.g. after the dataset changes). The tar is assembled from a
staging dir of symlinks (`avp_personal` → local AVP root, `lvt` → local LVT
root) with `tar -ch` to dereference them, guaranteeing clean top-level dirs.

## Flow for Tasks 9 / 11

### 1. Launch

```bash
bash training/infra/launch.sh \
  --run-id cnn-2026-07-17 \
  --cmd "uv run python -m beatrice_ml.train --config configs/avplvt_v1.ec2.yaml"
```

`launch.sh` prints the instance id and the poll/tail/terminate hints. The
`--cmd` runs from the `training/` directory, so relative paths
(`configs/...`, `data/manifest.csv`, `splits/...`) resolve.

Add `--refresh-data` only when the dataset itself changed.

### 2. Poll

```bash
bash training/infra/status.sh              # instance state + last S3 sync time
bash training/infra/logs.sh cnn-2026-07-17 # tail -100 of train.log from S3
```

Results (`train.log`, checkpoints, anything the run writes under
`runs/<run-id>/`) sync to S3 every 10 minutes and once more at exit — so they
survive termination. Pull them with `aws s3 sync s3://$BUCKET/runs/<run-id>/ .`.

### 3. Terminate

Normally you don't have to: the instance powers off (→ terminates) when the run
finishes, and the 12h timer is the backstop. To reap explicitly / defensively:

```bash
bash training/infra/terminate.sh
```

It prints the `Project=beatrice` instances before and after, terminates any it
finds, and is a safe no-op otherwise.
