#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
COMPOSE_SERVICES=(postgres redis backend worker dashboard mediamtx)

cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/dev.sh up               # Check prerequisites, build, and start the full stack
  ./scripts/dev.sh doctor           # Check Docker / Compose prerequisites
  ./scripts/dev.sh ps               # Show compose service status
  ./scripts/dev.sh logs [service]   # Follow compose logs
  ./scripts/dev.sh down             # Stop and remove the compose stack
  ./scripts/dev.sh reset            # Remove containers, volumes, and local bind-mount data
  ./scripts/dev.sh install-docker   # Ubuntu helper for Docker installation
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
  require_compose

  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Missing compose file: $COMPOSE_FILE"
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Cannot access Docker daemon."
    echo "Ensure Docker Desktop is running, or on Linux run:"
    echo "  sudo systemctl enable --now docker"
    echo "  sudo usermod -aG docker \$USER"
    echo "Then restart your terminal session and retry."
    exit 1
  fi

  echo "Docker OK: $(docker --version)"
  echo "Compose OK: $(docker compose version --short)"
}

container_id_for() {
  docker compose ps -q "$1"
}

container_running() {
  local service="$1"
  local container_id
  container_id="$(container_id_for "$service")"

  [[ -n "$container_id" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null || true)" == "true" ]]
}

container_healthy() {
  local service="$1"
  local container_id
  container_id="$(container_id_for "$service")"

  [[ -n "$container_id" ]] && [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)" == "healthy" ]]
}

wait_for_running() {
  local service="$1"

  echo "[wait] Waiting for $service to be running..."
  for _ in {1..60}; do
    if container_running "$service"; then
      echo "$service is running."
      return
    fi
    sleep 1
  done

  echo "$service did not reach running state in time."
  exit 1
}

wait_for_healthy() {
  local service="$1"

  echo "[wait] Waiting for $service to be healthy..."
  for _ in {1..60}; do
    if container_healthy "$service"; then
      echo "$service is healthy."
      return
    fi
    sleep 1
  done

  echo "$service did not become healthy in time."
  exit 1
}

up_stack() {
  check_prereqs

  echo "[compose] Starting full stack: ${COMPOSE_SERVICES[*]}"
  docker compose up -d --build --remove-orphans "${COMPOSE_SERVICES[@]}"

  wait_for_healthy postgres
  wait_for_healthy redis
  wait_for_healthy backend
  wait_for_healthy dashboard
  wait_for_running worker
  wait_for_running mediamtx

  echo
  echo "EgoFlow stack is ready."
  echo "Backend health: http://127.0.0.1:3000/api/v1/health"
  echo "Dashboard:      http://127.0.0.1:8088"
  echo "RTMP ingest: rtmp://127.0.0.1:1935/live"
  echo "HLS output:  http://127.0.0.1:8888"
}

doctor() {
  check_prereqs
  echo "Compose file: $COMPOSE_FILE"
}

show_ps() {
  check_prereqs
  docker compose ps
}

show_logs() {
  check_prereqs
  docker compose logs -f --tail=200 "$@"
}

down_stack() {
  check_prereqs
  docker compose down --remove-orphans
  echo "Compose stack stopped and removed."
}

reset_env() {
  check_prereqs

  echo "Removing containers and volumes..."
  docker compose down -v --remove-orphans

  echo "Removing local bind-mount data..."
  rm -rf "$ROOT_DIR/data/redis"
  rm -rf "$ROOT_DIR/data/raw"
  rm -rf "$ROOT_DIR/data/datasets"

  echo "Reset complete."
  echo "Next: ./scripts/dev.sh up"
}

cmd="${1:-}"
case "$cmd" in
  up)
    up_stack
    ;;
  doctor)
    doctor
    ;;
  ps)
    show_ps
    ;;
  logs)
    shift || true
    show_logs "$@"
    ;;
  down)
    down_stack
    ;;
  reset)
    reset_env
    ;;
  install-docker)
    ./scripts/install-docker-ubuntu.sh
    ;;
  *)
    usage
    exit 1
    ;;
esac
