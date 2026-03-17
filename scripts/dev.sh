#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev.sh install-docker   # Ubuntu only
  ./scripts/dev.sh check
  ./scripts/dev.sh setup
  ./scripts/dev.sh start
  ./scripts/dev.sh stop
  ./scripts/dev.sh reset
EOF
}

cmd="${1:-}"
case "$cmd" in
  install-docker)
    ./scripts/install-docker-ubuntu.sh
    ;;
  check)
    ./scripts/check-prereqs.sh
    ;;
  setup)
    ./scripts/dev-setup.sh
    ;;
  start)
    ./scripts/dev-start.sh
    ;;
  stop)
    ./scripts/dev-stop.sh
    ;;
  reset)
    ./scripts/dev-reset.sh
    ;;
  *)
    usage
    exit 1
    ;;
esac
