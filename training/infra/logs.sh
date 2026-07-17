#!/usr/bin/env bash
#
# logs.sh — tail the last 100 lines of a run's train.log from S3.
#
# Usage: ./logs.sh <run-id>
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2

BUCKET="beatrice-ml-387391740137-usw2"

RUN_ID="${1:-}"
[ -n "$RUN_ID" ] || { echo "usage: $0 <run-id>" >&2; exit 2; }

aws s3 cp "s3://$BUCKET/runs/$RUN_ID/train.log" - | tail -100
