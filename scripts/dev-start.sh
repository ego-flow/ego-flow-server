#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/check-prereqs.sh

echo "[1/3] Starting infra containers (postgres, redis)..."
docker compose up -d postgres redis

echo "[2/3] Checking backend env file..."
if [[ ! -f "$ROOT_DIR/backend/.env" ]]; then
  echo "backend/.env is missing. Run: ./scripts/dev-setup.sh"
  exit 1
fi

echo "[3/3] Starting backend dev server..."
npm --prefix "$ROOT_DIR/backend" run dev
