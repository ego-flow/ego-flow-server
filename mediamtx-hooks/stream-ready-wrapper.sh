#!/bin/sh
BACKEND_URL="${EGOFLOW_BACKEND_URL:-http://backend:3000}"

url_decode() {
  # %XX -> raw byte (form-urlencoded). awk used so it works under busybox sh
  # where printf '%b' does not expand \xHH.
  printf '%s' "$1" | awk '
    BEGIN { for (i = 0; i < 256; i++) hex[sprintf("%02X", i)] = sprintf("%c", i) }
    {
      gsub(/\+/, " ")
      while (match($0, /%[0-9A-Fa-f][0-9A-Fa-f]/)) {
        $0 = substr($0, 1, RSTART - 1) hex[toupper(substr($0, RSTART + 1, 2))] substr($0, RSTART + RLENGTH)
      }
      printf "%s", $0
    }
  '
}

extract_ticket() {
  printf '%s' "$1" | tr '&' '\n' | sed -n 's/^ticket=//p' | head -n 1
}

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\r\n'
}

MTX_QUERY_RAW="${MTX_QUERY:-}"
MTX_SOURCE_QUERY_RAW="${MTX_SOURCE_QUERY:-}"

QUERY="$(url_decode "$MTX_QUERY_RAW")"
TICKET="$(extract_ticket "$QUERY")"

if [ -z "$TICKET" ] && [ -n "$MTX_SOURCE_QUERY_RAW" ]; then
  TICKET="$(extract_ticket "$(url_decode "$MTX_SOURCE_QUERY_RAW")")"
fi

if [ -z "$TICKET" ]; then
  case "$MTX_PATH" in
    *\?*)
      PATH_QUERY="$(url_decode "${MTX_PATH#*\?}")"
      TICKET="$(extract_ticket "$PATH_QUERY")"
      ;;
  esac
fi

if [ -z "$TICKET" ]; then
  {
    echo "[stream-ready-wrapper] ticket-empty path=$MTX_PATH"
    env | grep '^MTX_' || true
  } >&2
fi

ESC_PATH="$(json_escape "$MTX_PATH")"
ESC_QUERY="$(json_escape "$QUERY")"
ESC_TICKET="$(json_escape "$TICKET")"

wget -qO /dev/null --post-data="{\"path\":\"$ESC_PATH\",\"query\":\"$ESC_QUERY\",\"ticket\":\"$ESC_TICKET\"}" \
  --header="Content-Type: application/json" \
  "${BACKEND_URL}/api/v1/hooks/stream-ready" 2>/dev/null || true
