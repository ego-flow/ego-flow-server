#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

./scripts/check-prereqs.sh

echo "[1/6] Starting infra containers (postgres, redis)..."
docker compose up -d postgres redis

echo "[2/6] Waiting for PostgreSQL readiness..."
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U postgres -d egoflow >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" -eq 30 ]]; then
    echo "PostgreSQL did not become ready in time."
    exit 1
  fi
done

echo "[3/6] Waiting for Redis readiness..."
for i in {1..30}; do
  if docker compose exec -T redis redis-cli ping | grep -q "PONG"; then
    break
  fi
  sleep 1
  if [[ "$i" -eq 30 ]]; then
    echo "Redis did not become ready in time."
    exit 1
  fi
done

if [[ ! -f "$ROOT_DIR/backend/.env" ]]; then
  echo "[4/6] Creating backend/.env from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/backend/.env"
else
  echo "[4/6] backend/.env already exists (skip)."
fi

echo "[5/6] Installing backend dependencies..."
npm --prefix "$ROOT_DIR/backend" install

echo "[6/6] Running Prisma setup..."
npm --prefix "$ROOT_DIR/backend" run prisma:generate
npm --prefix "$ROOT_DIR/backend" run prisma:migrate:deploy
npm --prefix "$ROOT_DIR/backend" run db:seed

echo ""
echo "Setup complete."
echo "Next: ./scripts/dev-start.sh"
