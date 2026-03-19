#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend-dev.pid"
WORKER_PID_FILE="$RUN_DIR/worker-dev.pid"
COMPOSE_INFRA_SERVICES=(postgres redis mediamtx)
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev.sh install-docker   # Ubuntu only
  ./scripts/dev.sh check
  ./scripts/dev.sh setup            # Safe to re-run: bootstrap infra/env/deps/db only
  ./scripts/dev.sh start            # Safe to re-run: bootstrap, then run backend dev server
  ./scripts/dev.sh worker           # Start video worker after setup/start
  ./scripts/dev.sh stop             # Stop infra containers only
  ./scripts/dev.sh reset            # Remove local containers/volumes and redis data
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

check_prereqs() {
  require_cmd docker
  require_cmd node
  require_cmd npm

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is missing or not available."
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Cannot access Docker daemon."
    echo "If this is Linux, ensure docker service is running and user is in docker group."
    echo "Run: sudo systemctl enable --now docker && sudo usermod -aG docker \$USER"
    echo "Then re-login and retry."
    exit 1
  fi

  echo "Prerequisites OK: docker, compose, node, npm."
}

ensure_run_dir() {
  mkdir -p "$RUN_DIR"
}

pidfile_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" >/dev/null 2>&1
}

clear_stale_pidfile() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]] && ! pidfile_running "$pidfile"; then
    rm -f "$pidfile"
  fi
}

process_running_matching() {
  local pattern="$1"
  command -v pgrep >/dev/null 2>&1 && pgrep -af "$pattern" >/dev/null 2>&1
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

start_infra() {
  echo "[1/5] Starting infra containers (${COMPOSE_INFRA_SERVICES[*]})..."
  docker compose up -d --remove-orphans "${COMPOSE_INFRA_SERVICES[@]}"
}

wait_for_postgres() {
  echo "[2/5] Waiting for PostgreSQL readiness..."
  for i in {1..30}; do
    if docker compose exec -T postgres pg_isready -U postgres -d egoflow >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done

  echo "PostgreSQL did not become ready in time."
  exit 1
}

wait_for_redis() {
  echo "[3/5] Waiting for Redis readiness..."
  for i in {1..30}; do
    if docker compose exec -T redis redis-cli ping | grep -q "PONG"; then
      return
    fi
    sleep 1
  done

  echo "Redis did not become ready in time."
  exit 1
}

ensure_backend_env() {
  echo "[4/5] Ensuring backend env file..."
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
  echo "[5/5] Ensuring backend dependencies..."
  if needs_backend_install; then
    npm --prefix "$BACKEND_DIR" install
    return
  fi

  echo "backend/node_modules is up to date (skip)."
}

bootstrap_backend() {
  check_prereqs
  start_infra
  wait_for_postgres
  wait_for_redis
  ensure_backend_env
  ensure_backend_dependencies

  echo "[db] Generating Prisma client..."
  npm --prefix "$BACKEND_DIR" run prisma:generate

  echo "[db] Applying Prisma migrations..."
  npm --prefix "$BACKEND_DIR" run prisma:migrate:deploy

  echo "[db] Seeding baseline data..."
  npm --prefix "$BACKEND_DIR" run db:seed
}

run_foreground_with_pidfile() {
  local label="$1"
  local pidfile="$2"
  shift 2

  ensure_run_dir
  clear_stale_pidfile "$pidfile"

  if pidfile_running "$pidfile"; then
    echo "$label is already running with pid $(cat "$pidfile")."
    return 0
  fi

  "$@" &
  local child_pid=$!
  echo "$child_pid" >"$pidfile"

  trap 'rm -f '"'"$pidfile"'"'; if kill -0 '"$child_pid"' >/dev/null 2>&1; then kill '"$child_pid"' >/dev/null 2>&1 || true; fi' EXIT INT TERM
  wait "$child_pid"
  local exit_code=$?
  rm -f "$pidfile"
  trap - EXIT INT TERM
  return "$exit_code"
}

start_backend() {
  bootstrap_backend

  local port
  port="$(backend_port)"

  clear_stale_pidfile "$BACKEND_PID_FILE"
  if pidfile_running "$BACKEND_PID_FILE"; then
    echo "Backend dev server is already running with pid $(cat "$BACKEND_PID_FILE")."
    return 0
  fi

  if process_running_matching "ts-node src/index.ts|node dist/index.js"; then
    echo "A backend process already appears to be running. Skip duplicate start."
    return 0
  fi

  if backend_healthcheck_ok "$port"; then
    echo "Backend is already responding on port $port. Skip duplicate start."
    return 0
  fi

  echo "[run] Starting backend dev server on port $port..."
  run_foreground_with_pidfile "Backend dev server" "$BACKEND_PID_FILE" npm --prefix "$BACKEND_DIR" run dev
}

start_worker() {
  check_prereqs
  start_infra
  wait_for_postgres
  wait_for_redis
  ensure_backend_env
  ensure_backend_dependencies

  clear_stale_pidfile "$WORKER_PID_FILE"
  if pidfile_running "$WORKER_PID_FILE"; then
    echo "Worker dev server is already running with pid $(cat "$WORKER_PID_FILE")."
    return 0
  fi

  if process_running_matching "ts-node src/worker.ts|node dist/worker.js"; then
    echo "A worker process already appears to be running. Skip duplicate start."
    return 0
  fi

  echo "[run] Starting worker dev server..."
  run_foreground_with_pidfile "Worker dev server" "$WORKER_PID_FILE" npm --prefix "$BACKEND_DIR" run worker:dev
}

stop_infra() {
  require_cmd docker

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin is missing or not available."
    exit 1
  fi

  docker compose stop "${COMPOSE_INFRA_SERVICES[@]}"
  echo "Stopped infra containers: ${COMPOSE_INFRA_SERVICES[*]}"
}

reset_env() {
  check_prereqs

  echo "Removing local containers and volumes..."
  docker compose down -v --remove-orphans

  echo "Removing redis bind-mount data..."
  rm -rf "$ROOT_DIR/data/redis"

  echo "Reset complete."
  echo "Next: ./scripts/dev.sh setup"
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
    bootstrap_backend
    ;;
  start)
    start_backend
    ;;
  worker)
    start_worker
    ;;
  stop)
    stop_infra
    ;;
  reset)
    reset_env
    ;;
  *)
    usage
    exit 1
    ;;
esac
