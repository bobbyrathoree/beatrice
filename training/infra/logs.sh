#!/usr/bin/env bash
#
# logs.sh — tail the last 100 lines of a run's train.log from S3.
#
# Usage: ./logs.sh <run-id>
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2

# Bucket defaults to beatrice-ml-<account-id>-usw2, derived from the caller's
# AWS account at runtime; override with BEATRICE_S3_BUCKET.
BUCKET="${BEATRICE_S3_BUCKET:-beatrice-ml-$(aws sts get-caller-identity --query Account --output text)-usw2}"

RUN_ID="${1:-}"
[ -n "$RUN_ID" ] || { echo "usage: $0 <run-id>" >&2; exit 2; }

if ! aws s3 cp "s3://$BUCKET/runs/$RUN_ID/train.log" - 2>/dev/null | tail -100; then
  echo "no log yet for $RUN_ID"
fi
