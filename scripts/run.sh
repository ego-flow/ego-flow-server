#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE_FILE="$ROOT_DIR/compose.yml"
COMPOSE_LOCAL_FILE="$ROOT_DIR/compose.local.yml"
COMPOSE_SERVICES=(postgres redis backend worker dashboard proxy mediamtx)
MODE="local"

cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run.sh up               # Check prerequisites, build, and start the local stack
  ./scripts/run.sh doctor           # Check Docker / Compose prerequisites
  ./scripts/run.sh ps               # Show compose service status
  ./scripts/run.sh logs [service]   # Follow compose logs
  ./scripts/run.sh down             # Stop and remove the compose stack
  ./scripts/run.sh reset            # Remove containers, volumes, and local bind-mount data
  ./scripts/run.sh install-docker   # Ubuntu helper for Docker installation

Notes:
  - Local compose uses compose.yml + compose.local.yml.
  - Remote EC2 deployment still uses deploy/ec2/deploy.sh for server-side pull/up work.
  - config.json and .env are required for the current local stack.
  - PUBLIC_HTTP_PORT fronts both the API and dashboard through the local reverse proxy.
  - reset is a local-development helper only; production data changes follow deploy/ec2/data-operations.md.
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

compose_cmd() {
  docker compose -f "$COMPOSE_BASE_FILE" -f "$COMPOSE_LOCAL_FILE" "$@"
}

read_config_number() {
  local key="$1"
  local default_value="$2"
  local value

  value="$(
    tr -d '\n' < "$ROOT_DIR/config.json" |
      sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*([0-9]+).*/\\1/p"
  )"

  if [[ -n "$value" ]]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

load_port_overrides() {
  export PUBLIC_HTTP_PORT
  export RTMP_PORT
  export HLS_PORT

  PUBLIC_HTTP_PORT="$(read_config_number "PUBLIC_HTTP_PORT" "80")"
  RTMP_PORT="$(read_config_number "RTMP_PORT" "1935")"
  HLS_PORT="$(read_config_number "HLS_PORT" "8888")"
}

public_http_base() {
  if [[ "$PUBLIC_HTTP_PORT" == "80" ]]; then
    echo "http://localhost"
  else
    echo "http://localhost:${PUBLIC_HTTP_PORT}"
  fi
}

check_prereqs() {
  require_cmd docker
  require_compose

  if [[ ! -f "$COMPOSE_BASE_FILE" ]]; then
    echo "Missing compose file: $COMPOSE_BASE_FILE"
    exit 1
  fi

  if [[ ! -f "$COMPOSE_LOCAL_FILE" ]]; then
    echo "Missing compose file: $COMPOSE_LOCAL_FILE"
    exit 1
  fi

  if [[ ! -f "$ROOT_DIR/config.json" ]]; then
    echo "Missing config file: $ROOT_DIR/config.json"
    echo "Create it from $ROOT_DIR/config.json.example before running the stack."
    exit 1
  fi

  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    echo "Missing env file: $ROOT_DIR/.env"
    echo "Create it from $ROOT_DIR/.env.example before running the stack."
    exit 1
  fi

  load_port_overrides

  if ! docker info >/dev/null 2>&1; then
    echo "Cannot access Docker daemon."
    echo "Ensure Docker Desktop is running, or on Linux run:"
    echo "  sudo systemctl enable --now docker"
    echo "  sudo usermod -aG docker \$USER"
    echo "Then restart your terminal session and retry."
    exit 1
  fi

  echo "Mode: ${MODE}"
  echo "Docker OK: $(docker --version)"
  echo "Compose OK: $(docker compose version --short)"
  echo "HTTP port: ${PUBLIC_HTTP_PORT}"
  echo "RTMP port: ${RTMP_PORT}"
  echo "HLS port: ${HLS_PORT}"
}

container_id_for() {
  compose_cmd ps -q "$1"
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
  local http_base
  http_base="$(public_http_base)"

  echo "[compose] Starting local stack: ${COMPOSE_SERVICES[*]}"
  compose_cmd up -d --build --remove-orphans "${COMPOSE_SERVICES[@]}"

  wait_for_healthy postgres
  wait_for_healthy redis
  wait_for_healthy backend
  wait_for_healthy dashboard
  wait_for_healthy proxy
  wait_for_running worker
  wait_for_running mediamtx

  echo
  echo "EgoFlow local stack is ready."
  echo "Backend health: ${http_base}/api/v1/health"
  echo "Swagger UI:     ${http_base}/api-docs"
  echo "Dashboard:      ${http_base}"
  echo "RTMP ingest:    rtmp://localhost:${RTMP_PORT}/live"
  echo "HLS output:     http://localhost:${HLS_PORT}"
}

doctor() {
  check_prereqs
  echo "Compose files:"
  echo "  - $COMPOSE_BASE_FILE"
  echo "  - $COMPOSE_LOCAL_FILE"
}

show_ps() {
  check_prereqs
  compose_cmd ps
}

show_logs() {
  check_prereqs
  compose_cmd logs -f --tail=200 "$@"
}

down_stack() {
  check_prereqs
  compose_cmd down --remove-orphans
  echo "Compose stack stopped and removed."
}

reset_env() {
  check_prereqs

  echo "Warning: reset removes containers, volumes, and local bind-mount data under ./data/."
  echo "This command is for local development only. It is not a production data operation."
  echo "Removing containers and volumes..."
  compose_cmd down -v --remove-orphans

  echo "Removing local bind-mount data..."
  rm -rf "$ROOT_DIR/data/postgres"
  rm -rf "$ROOT_DIR/data/redis"
  rm -rf "$ROOT_DIR/data/raw"
  rm -rf "$ROOT_DIR/data/datasets"

  echo "Reset complete."
  echo "Next: ./scripts/run.sh up"
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
