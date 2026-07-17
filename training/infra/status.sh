#!/usr/bin/env bash
#
# status.sh — list Project=beatrice instances + the latest S3 run heartbeat.
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2

BUCKET="beatrice-ml-387391740137-usw2"

echo "== Project=beatrice instances =="
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=beatrice" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,LaunchTime,InstanceType]' \
  --output table

echo
echo "== Latest S3 run heartbeat =="
# Newest object under runs/ tells us which run is live and when it last synced.
LATEST=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "runs/" \
  --query 'sort_by(Contents,&LastModified)[-1].[Key,LastModified]' \
  --output text 2>/dev/null || true)
if [ -z "$LATEST" ] || [ "$LATEST" = "None" ]; then
  echo "no runs found under s3://$BUCKET/runs/"
else
  echo "last synced object: $LATEST"
fi
