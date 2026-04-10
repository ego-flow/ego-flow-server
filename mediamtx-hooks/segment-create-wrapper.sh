#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://backend:3000}"
wget -qO /dev/null --post-data="{\"path\":\"$MTX_PATH\",\"source_id\":\"$MTX_SOURCE_ID\",\"segment_path\":\"$MTX_SEGMENT_PATH\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/recording-segment-create" 2>/dev/null || true
