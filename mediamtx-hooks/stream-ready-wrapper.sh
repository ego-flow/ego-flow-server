#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://backend:3000}"
wget -qO /dev/null --post-data="{\"path\":\"$MTX_PATH\",\"query\":\"$MTX_QUERY\",\"source_id\":\"$MTX_SOURCE_ID\",\"source_type\":\"$MTX_SOURCE_TYPE\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/stream-ready" 2>/dev/null || true
