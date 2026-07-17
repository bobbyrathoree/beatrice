#!/usr/bin/env bash
#
# bootstrap.sh — EC2 user-data, runs as root on the Ubuntu 22.04 DLAMI.
#
# This file is a TEMPLATE. launch.sh renders it into bootstrap-rendered.sh by
# substituting the __RUN_ID__ and __BUCKET__ placeholders below, then passes the
# rendered file as --user-data. Do not run this template directly.
#
# Order of operations (safety first):
#   0. INSTALL THE 12h SELF-TERMINATE TIMER + EXIT poweroff TRAP *FIRST*,
#      before any network call, so a setup failure/hang can never leak an
#      instance (before timer) or idle it for 12h (before trap).
#   1. install uv + pull code/data from S3 and untar
#   3. uv sync
#   4. run runs/<run-id>/cmd.sh, logging to runs/<run-id>/train.log
#   5. sync runs/<run-id>/ to S3 every 10 min (background) and once at exit
#   6. poweroff  (with --instance-initiated-shutdown-behavior terminate ⇒ terminate)
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2

RUN_ID="__RUN_ID__"
BUCKET="__BUCKET__"

HOME_DIR="/root"
export HOME="$HOME_DIR"
WORK="$HOME_DIR/beatrice"
DATA_DIR="$HOME_DIR/datasets_ec2"
TRAIN_DIR="$WORK/training"
RUN_DIR="$TRAIN_DIR/runs/$RUN_ID"
LOG="$RUN_DIR/train.log"

log() { echo "[bootstrap $(date -u +%FT%TZ)] $*"; }

# --- 0. cost-safety guards BEFORE any network call ------------------------ #
# Install these FIRST so a failure/hang in setup (curl, s3 cp, tar, sed, uv
# sync) can never leave the instance running past 12h or idling indefinitely.

# 12h self-terminate timer.
log "installing 12h self-terminate timer"
cat >/etc/systemd/system/beatrice-selfterminate.service <<'EOF'
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl poweroff
EOF
cat >/etc/systemd/system/beatrice-selfterminate.timer <<'EOF'
[Timer]
OnBootSec=12h
[Install]
WantedBy=timers.target
EOF
systemctl enable --now beatrice-selfterminate.timer

# Best-effort final sync + poweroff on ANY exit (S3 may be unreachable in a
# failure path, hence || true inside sync_run). SYNC_PID is empty until the
# background sync loop starts later, so finish() is safe to fire before then.
sync_run() { aws s3 sync "$RUN_DIR/" "s3://$BUCKET/runs/$RUN_ID/" --no-progress || true; }

SYNC_PID=""
finish() {
  log "finishing: stopping sync loop, final sync, poweroff"
  [ -n "$SYNC_PID" ] && kill "$SYNC_PID" 2>/dev/null || true
  sync_run
  poweroff
}
trap finish EXIT

# --- 1. install uv + pull code/data --------------------------------------- #
log "installing uv"
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME_DIR/.local/bin:$PATH"

log "pulling code + data from s3://$BUCKET"
mkdir -p "$WORK" "$DATA_DIR"
aws s3 cp "s3://$BUCKET/code/beatrice-training.tar.gz" /tmp/code.tar.gz
aws s3 cp "s3://$BUCKET/data/manifest.csv"            /tmp/manifest.csv
aws s3 cp "s3://$BUCKET/data/audio.tar"               /tmp/audio.tar

# git archive HEAD training/ carries the "training/" prefix, so untarring into
# $WORK yields $WORK/training/.
tar -xzf /tmp/code.tar.gz -C "$WORK"
mkdir -p "$TRAIN_DIR/data"
cp /tmp/manifest.csv "$TRAIN_DIR/data/manifest.csv"

# audio.tar carries BOTH dataset roots under top-level avp_personal/ and lvt/.
tar -xf /tmp/audio.tar -C "$DATA_DIR"

# EC2 config override: copy the checked-in config and sed-patch the two data
# roots to the untarred EC2 locations. Task 9/11 cmds point at this file.
mkdir -p "$RUN_DIR"
EC2_CONFIG="$TRAIN_DIR/configs/avplvt_v1.ec2.yaml"
sed -e "s#^\([[:space:]]*avp_root:\).*#\1 $DATA_DIR/avp_personal#" \
    -e "s#^\([[:space:]]*lvt_root:\).*#\1 $DATA_DIR/lvt#" \
    "$TRAIN_DIR/configs/avplvt_v1.yaml" > "$EC2_CONFIG"
log "wrote EC2 config override -> $EC2_CONFIG"

# --- 3. uv sync ----------------------------------------------------------- #
log "uv sync"
cd "$TRAIN_DIR"
uv sync

# --- 5. background S3 sync loop (exit trap installed in section 0) -------- #
( while true; do sleep 600; sync_run; done ) &
SYNC_PID=$!

# --- 4. fetch + run the command ------------------------------------------- #
log "fetching runs/$RUN_ID/cmd.sh"
aws s3 cp "s3://$BUCKET/runs/$RUN_ID/cmd.sh" "$RUN_DIR/cmd.sh"
chmod +x "$RUN_DIR/cmd.sh"

log "starting run $RUN_ID -> $LOG"
# Run from training/ so relative config/manifest paths resolve. Never let a
# non-zero exit skip the exit trap (which does the final sync + poweroff).
set +e
bash "$RUN_DIR/cmd.sh" >"$LOG" 2>&1
RC=$?
set -e
log "run finished rc=$RC"
echo "exit_code=$RC" >"$RUN_DIR/exit_code.txt"

# EXIT trap handles final sync + poweroff.
