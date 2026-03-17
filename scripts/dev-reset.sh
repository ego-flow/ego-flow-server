#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/check-prereqs.sh

docker compose down -v --remove-orphans
echo "Reset complete: containers stopped and volumes removed."
