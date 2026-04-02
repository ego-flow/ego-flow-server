#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Transition-period compatibility wrapper: use ./scripts/run.sh instead." >&2
exec "$ROOT_DIR/scripts/run.sh" "$@"
