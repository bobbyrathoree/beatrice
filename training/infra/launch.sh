#!/usr/bin/env bash
#
# launch.sh — provision (idempotently) and launch ONE g6e.2xlarge training run.
#
# Usage:
#   ./launch.sh --run-id <id> --cmd "<command>" [--refresh-data]
#
# Example:
#   ./launch.sh --run-id cnn-2026-07-17 \
#     --cmd "uv run python -m beatrice_ml.train --config configs/avplvt_v1.ec2.yaml"
#
# Frugality guarantees (hard rules — see infra/README.md):
#   * on-demand g6e.2xlarge, us-west-2 only
#   * --instance-initiated-shutdown-behavior terminate
#   * 12h self-terminate timer installed by bootstrap BEFORE work starts
#   * zero-ingress security group (SSM-only access)
#   * every instance tagged Project=beatrice
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2

BUCKET="beatrice-ml-387391740137-usw2"
REGION="us-west-2"
INSTANCE_TYPE="g6e.2xlarge"
ROLE="beatrice-training"
PROFILE_NAME="beatrice-training"
SG_NAME="beatrice-training-sg"
AMI_SSM="/aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

RUN_ID=""
CMD=""
REFRESH_DATA=0

while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --cmd)    CMD="$2"; shift 2 ;;
    --refresh-data) REFRESH_DATA=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$RUN_ID" ] || { echo "error: --run-id required" >&2; exit 2; }
[ -n "$CMD" ]    || { echo "error: --cmd required" >&2; exit 2; }

log() { echo "[launch] $*"; }

# --- S3 bucket (create-if-absent) ----------------------------------------- #
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  log "bucket s3://$BUCKET present"
else
  log "creating bucket s3://$BUCKET"
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi

# --- IAM role + inline S3 policy + instance profile (idempotent) ---------- #
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
S3_POLICY=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$BUCKET"},
  {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::$BUCKET/*"}
]}
JSON
)

if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  log "IAM role $ROLE present"
else
  log "creating IAM role $ROLE"
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "$TRUST" >/dev/null
fi

aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
aws iam put-role-policy --role-name "$ROLE" \
  --policy-name beatrice-s3 --policy-document "$S3_POLICY" >/dev/null

if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "instance profile $PROFILE_NAME present"
else
  log "creating instance profile $PROFILE_NAME"
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
fi
# add-role-to-instance-profile fails if the role is already attached; ignore that.
aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" \
  --role-name "$ROLE" >/dev/null 2>&1 || true

# --- Security group: zero ingress ----------------------------------------- #
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  log "creating security group $SG_NAME (zero ingress)"
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" \
    --description "beatrice training — zero ingress, SSM only" \
    --query 'GroupId' --output text)
else
  log "security group $SG_NAME present ($SG_ID)"
fi
# Default SG has zero ingress on creation; we never add ingress rules.

# --- Resolve AMI from SSM ------------------------------------------------- #
AMI_ID=$(aws ssm get-parameter --name "$AMI_SSM" \
  --query 'Parameter.Value' --output text)
log "resolved AMI $AMI_ID"

# --- Pack + upload code ---------------------------------------------------- #
log "packing code (git archive HEAD training/)"
( cd "$REPO_ROOT" && git archive HEAD training/ | gzip ) > /tmp/beatrice-training.tar.gz
aws s3 cp /tmp/beatrice-training.tar.gz "s3://$BUCKET/code/beatrice-training.tar.gz"

log "uploading manifest"
aws s3 cp "$REPO_ROOT/training/data/manifest.csv" "s3://$BUCKET/data/manifest.csv"

# --- Build + upload audio.tar (cache: skip if present, unless --refresh) --- #
AUDIO_PRESENT=0
aws s3api head-object --bucket "$BUCKET" --key data/audio.tar >/dev/null 2>&1 && AUDIO_PRESENT=1
if [ "$AUDIO_PRESENT" = "1" ] && [ "$REFRESH_DATA" = "0" ]; then
  log "data/audio.tar already in S3 — skipping (pass --refresh-data to rebuild)"
else
  log "building audio.tar (avp_personal/ + lvt/) — this is ~1-2GB"
  AVP_ROOT="$HOME/datasets/AVP_Dataset/Personal"
  LVT_ROOT="$HOME/datasets/AVP-LVT/AVP-LVT_Dataset/LVT_Dataset"
  [ -d "$AVP_ROOT" ] || { echo "missing $AVP_ROOT" >&2; exit 1; }
  [ -d "$LVT_ROOT" ] || { echo "missing $LVT_ROOT" >&2; exit 1; }
  STAGE=$(mktemp -d)
  ln -s "$AVP_ROOT" "$STAGE/avp_personal"
  ln -s "$LVT_ROOT" "$STAGE/lvt"
  # -h dereferences the symlinks so the tar has real top-level avp_personal/ + lvt/.
  tar -C "$STAGE" -chf /tmp/audio.tar avp_personal lvt
  aws s3 cp /tmp/audio.tar "s3://$BUCKET/data/audio.tar"
  rm -rf "$STAGE"
fi

# --- Upload the run command ----------------------------------------------- #
log "uploading runs/$RUN_ID/cmd.sh"
CMD_FILE=$(mktemp)
{
  echo "#!/usr/bin/env bash"
  echo "set -euo pipefail"
  echo "$CMD"
} > "$CMD_FILE"
aws s3 cp "$CMD_FILE" "s3://$BUCKET/runs/$RUN_ID/cmd.sh"
rm -f "$CMD_FILE"

# --- Render bootstrap ------------------------------------------------------ #
log "rendering bootstrap"
RENDERED="/tmp/bootstrap-rendered.sh"
sed -e "s#__RUN_ID__#$RUN_ID#g" \
    -e "s#__BUCKET__#$BUCKET#g" \
    "$HERE/bootstrap.sh" > "$RENDERED"

# --- Launch ---------------------------------------------------------------- #
log "launching $INSTANCE_TYPE"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --instance-initiated-shutdown-behavior terminate \
  --iam-instance-profile "Name=$PROFILE_NAME" \
  --security-group-ids "$SG_ID" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=beatrice},{Key=Run,Value=$RUN_ID}]" \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":200,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]' \
  --user-data "file://$RENDERED" \
  --query 'Instances[0].InstanceId' --output text)

log "launched instance: $INSTANCE_ID (run-id=$RUN_ID)"
echo
echo "poll status:  bash $HERE/status.sh"
echo "tail logs:    bash $HERE/logs.sh $RUN_ID"
echo "terminate:    bash $HERE/terminate.sh"
