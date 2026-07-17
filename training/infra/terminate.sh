#!/usr/bin/env bash
set -euo pipefail
export AWS_PROFILE=default AWS_DEFAULT_REGION=us-west-2
list() {
  aws ec2 describe-instances \
    --filters "Name=tag:Project,Values=beatrice" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].[InstanceId,State.Name,LaunchTime]' --output table
}
echo "== Project=beatrice instances BEFORE =="; list
IDS=$(aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=beatrice" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "${IDS:-}" ]; then
  # shellcheck disable=SC2086  # $IDS is intentionally word-split: space-separated
  # instance IDs must become separate --instance-ids args.
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  echo "terminate requested: $IDS"
else
  echo "nothing to terminate"
fi
echo "== Project=beatrice instances AFTER =="; list
