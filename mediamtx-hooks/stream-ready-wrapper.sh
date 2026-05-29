#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://backend:3000}"

extract_ticket() {
  printf '%s' "$1" | tr '&' '\n' | sed -n 's/^ticket=//p' | head -n 1
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\r\n'
}

QUERY="${MTX_QUERY:-}"
TICKET="$(extract_ticket "$QUERY")"

if [ -z "$TICKET" ] && [ -n "${MTX_SOURCE_QUERY:-}" ]; then
  TICKET="$(extract_ticket "$MTX_SOURCE_QUERY")"
fi

if [ -z "$TICKET" ]; then
  case "$MTX_PATH" in
    *\?*)
      PATH_QUERY="${MTX_PATH#*\?}"
      TICKET="$(extract_ticket "$PATH_QUERY")"
      ;;
  esac
fi

if [ -z "$TICKET" ]; then
  {
    echo "[stream-ready-wrapper] ticket-empty path=$MTX_PATH source_id=$MTX_SOURCE_ID source_type=$MTX_SOURCE_TYPE"
    env | grep '^MTX_' || true
  } >&2
fi

ESC_PATH="$(json_escape "$MTX_PATH")"
ESC_QUERY="$(json_escape "$QUERY")"
ESC_TICKET="$(json_escape "$TICKET")"
ESC_SOURCE_ID="$(json_escape "$MTX_SOURCE_ID")"
ESC_SOURCE_TYPE="$(json_escape "$MTX_SOURCE_TYPE")"
ESC_MTX_QUERY="$(json_escape "${MTX_QUERY:-}")"
ESC_MTX_SOURCE_ID="$(json_escape "${MTX_SOURCE_ID:-}")"
ESC_MTX_SOURCE_TYPE="$(json_escape "${MTX_SOURCE_TYPE:-}")"
ESC_MTX_PATH="$(json_escape "${MTX_PATH:-}")"

wget -qO /dev/null --post-data="{\"path\":\"$ESC_PATH\",\"query\":\"$ESC_QUERY\",\"ticket\":\"$ESC_TICKET\",\"source_id\":\"$ESC_SOURCE_ID\",\"source_type\":\"$ESC_SOURCE_TYPE\",\"mtx_query\":\"$ESC_MTX_QUERY\",\"mtx_source_id\":\"$ESC_MTX_SOURCE_ID\",\"mtx_source_type\":\"$ESC_MTX_SOURCE_TYPE\",\"mtx_path\":\"$ESC_MTX_PATH\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/stream-ready" 2>/dev/null || true
