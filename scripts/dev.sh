#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"
COMPOSE_BACKEND_SERVICES=(postgres redis backend mediamtx)
COMPOSE_WORKER_SERVICES=(worker)
COMPOSE_ALL_SERVICES=(postgres redis backend worker mediamtx)
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev.sh install-docker   # Ubuntu only
  ./scripts/dev.sh check
  ./scripts/dev.sh setup            # Safe to re-run: local env/deps/prisma bootstrap only
  ./scripts/dev.sh start            # Compose-based backend stack start/rebuild
  ./scripts/dev.sh worker           # Compose-based worker start/rebuild
  ./scripts/dev.sh stop             # Stop full compose stack
  ./scripts/dev.sh reset            # Remove local containers/volumes and redis data
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_compose() {
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is missing or not available."
    exit 1
  fi
}

check_prereqs() {
  require_cmd docker
  require_cmd node
  require_cmd npm

  require_compose

  if ! docker info >/dev/null 2>&1; then
    echo "Cannot access Docker daemon."
    echo "If this is Linux, ensure docker service is running and user is in docker group."
    echo "Run: sudo systemctl enable --now docker && sudo usermod -aG docker \$USER"
    echo "Then re-login and retry."
    exit 1
  fi

  echo "Prerequisites OK: docker, compose, node, npm."
}

backend_port() {
  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    awk -F= '/^PORT=/{print $2; exit}' "$BACKEND_ENV_FILE"
    return
  fi

  echo "3000"
}

backend_healthcheck_ok() {
  local port
  port="${1:-$(backend_port)}"

  node -e '
const http = require("http");
const port = Number(process.argv[1]);
const req = http.get({ host: "127.0.0.1", port, path: "/api/v1/health", timeout: 1000 }, (res) => {
  let body = "";
  res.on("data", (chunk) => {
    body += chunk;
  });
  res.on("end", () => {
    process.exit(res.statusCode === 200 && body.includes("\"status\":\"ok\"") ? 0 : 1);
  });
});
req.on("error", () => process.exit(1));
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
' "$port" >/dev/null 2>&1
}

ensure_backend_env() {
  echo "[env] Ensuring backend env file..."
  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    echo "backend/.env already exists (skip)."
    return
  fi

  cp "$ROOT_DIR/.env.example" "$BACKEND_ENV_FILE"
  echo "Created backend/.env from .env.example."
}

needs_backend_install() {
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    return 0
  fi

  if [[ ! -f "$BACKEND_DIR/node_modules/.package-lock.json" ]]; then
    return 0
  fi

  [[ "$BACKEND_DIR/package-lock.json" -nt "$BACKEND_DIR/node_modules/.package-lock.json" ]]
}

ensure_backend_dependencies() {
  echo "[deps] Ensuring backend dependencies..."
  if needs_backend_install; then
    npm --prefix "$BACKEND_DIR" install
    return
  fi

  echo "backend/node_modules is up to date (skip)."
}

bootstrap_local_dev() {
  check_prereqs
  ensure_backend_env
  ensure_backend_dependencies

  echo "[prisma] Generating local Prisma client..."
  npm --prefix "$BACKEND_DIR" run prisma:generate
}

wait_for_backend_health() {
  local port
  port="$(backend_port)"

  echo "[health] Waiting for backend health on port $port..."
  for _ in {1..30}; do
    if backend_healthcheck_ok "$port"; then
      echo "Backend is responding on port $port."
      return
    fi
    sleep 1
  done

  echo "Backend did not become healthy in time."
  exit 1
}

worker_container_running() {
  local container_id
  container_id="$(docker compose ps -q worker)"
  [[ -n "$container_id" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null || true)" == "true" ]]
}

wait_for_worker_running() {
  echo "[health] Waiting for worker container..."
  for _ in {1..30}; do
    if worker_container_running; then
      echo "Worker container is running."
      return
    fi
    sleep 1
  done

  echo "Worker container did not become ready in time."
  exit 1
}

compose_up() {
  docker compose up -d --build --remove-orphans "$@"
}

start_backend_stack() {
  check_prereqs
  ensure_backend_env

  echo "[compose] Starting backend stack: ${COMPOSE_BACKEND_SERVICES[*]}"
  compose_up "${COMPOSE_BACKEND_SERVICES[@]}"
  wait_for_backend_health
}

start_worker_stack() {
  check_prereqs
  ensure_backend_env

  echo "[compose] Starting worker service: ${COMPOSE_WORKER_SERVICES[*]}"
  compose_up "${COMPOSE_WORKER_SERVICES[@]}"
  wait_for_worker_running
}

stop_stack() {
  require_cmd docker
  require_compose

  docker compose stop "${COMPOSE_ALL_SERVICES[@]}"
  echo "Stopped compose services: ${COMPOSE_ALL_SERVICES[*]}"
}

reset_env() {
  check_prereqs

  echo "Removing local containers and volumes..."
  docker compose down -v --remove-orphans

  echo "Removing redis bind-mount data..."
  rm -rf "$ROOT_DIR/data/redis"

  echo "Reset complete."
  echo "Next: ./scripts/dev.sh start"
}

cmd="${1:-}"
case "$cmd" in
  install-docker)
    ./scripts/install-docker-ubuntu.sh
    ;;
  check)
    check_prereqs
    ;;
  setup)
    bootstrap_local_dev
    ;;
  start)
    start_backend_stack
    ;;
  worker)
    start_worker_stack
    ;;
  stop)
    stop_stack
    ;;
  reset)
    reset_env
    ;;
  *)
    usage
    exit 1
    ;;
esac
