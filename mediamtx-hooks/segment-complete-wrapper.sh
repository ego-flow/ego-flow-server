#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://host.docker.internal:3000}"
wget -qO /dev/null --post-data="{\"path\":\"$MTX_PATH\",\"segment_path\":\"$MTX_SEGMENT_PATH\",\"segment_duration\":\"$MTX_SEGMENT_DURATION\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/recording-segment-complete" 2>/dev/null || true
