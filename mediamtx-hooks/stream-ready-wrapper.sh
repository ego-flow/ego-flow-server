#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://backend:3000}"
QUERY="${MTX_QUERY:-}"
TICKET="$(printf '%s' "$QUERY" | tr '&' '\n' | sed -n 's/^ticket=//p' | head -n 1)"
wget -qO /dev/null --post-data="{\"path\":\"$MTX_PATH\",\"query\":\"$QUERY\",\"ticket\":\"$TICKET\",\"source_id\":\"$MTX_SOURCE_ID\",\"source_type\":\"$MTX_SOURCE_TYPE\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/stream-ready" 2>/dev/null || true
