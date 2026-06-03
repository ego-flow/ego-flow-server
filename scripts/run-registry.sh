#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE_FILE="$ROOT_DIR/compose.yml"
COMPOSE_REGISTRY_FILE="$ROOT_DIR/compose.registry.yml"
COMPOSE_SERVICES=(postgres redis backend worker dashboard proxy mediamtx)
RUN_STATE_DIR="$ROOT_DIR/.run"
TRACKED_BIND_MOUNT_CONFIGS=(
  "proxy:Caddyfile"
  "mediamtx:mediamtx.yml mediamtx-hooks certs"
)
REGISTRY="${REGISTRY:-ghcr.io}"
REGISTRY_OWNER="${REGISTRY_OWNER:-dennis0405}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ego-flow-server}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-backend:${IMAGE_TAG}}"
DASHBOARD_IMAGE="${DASHBOARD_IMAGE:-${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-dashboard:${IMAGE_TAG}}"

export BACKEND_IMAGE
export DASHBOARD_IMAGE
export IMAGE_TAG

cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  IMAGE_TAG=<tag> ./scripts/run-registry.sh up
  ./scripts/run-registry.sh ps
  ./scripts/run-registry.sh logs [service]
  ./scripts/run-registry.sh down

This registry runtime uses compose.registry.yml and never builds images on the server.
For private GHCR packages, log in first:
  gh auth token | docker login ghcr.io -u dennis0405 --password-stdin
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
  docker compose -f "$COMPOSE_BASE_FILE" -f "$COMPOSE_REGISTRY_FILE" "$@"
}

read_config_string() {
  local key="$1"
  local value

  value="$(
    tr -d '\n' < "$ROOT_DIR/config.json" |
      sed -nE "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\\1/p"
  )"

  if [[ -n "$value" ]]; then
    echo "$value"
    return
  fi

  echo "Missing or invalid string config key: ${key}"
  exit 1
}

normalize_target_directory() {
  local configured_value="$1"

  case "$configured_value" in
    "~")
      echo "${HOME:?TARGET_DIRECTORY uses ~ but HOME is not set.}"
      ;;
    "~/"*)
      echo "${HOME:?TARGET_DIRECTORY uses ~ but HOME is not set.}/${configured_value#"~/"}"
      ;;
    /*)
      echo "$configured_value"
      ;;
    *)
      echo "TARGET_DIRECTORY must be an absolute path or use ~/... shorthand." >&2
      exit 1
      ;;
  esac
}

load_runtime_overrides() {
  export PUBLIC_HTTP_PORT
  export TARGET_DIRECTORY
  export HOST_HOME

  PUBLIC_HTTP_PORT="80"
  TARGET_DIRECTORY="$(normalize_target_directory "$(read_config_string "TARGET_DIRECTORY")")"
  HOST_HOME="${HOME:-}"
}

public_http_base() {
  echo "http://localhost"
}

check_prereqs() {
  require_cmd docker
  require_compose

  [[ -f "$COMPOSE_BASE_FILE" ]] || {
    echo "Missing compose file: $COMPOSE_BASE_FILE"
    exit 1
  }
  [[ -f "$COMPOSE_REGISTRY_FILE" ]] || {
    echo "Missing compose registry file: $COMPOSE_REGISTRY_FILE"
    exit 1
  }
  [[ -f "$ROOT_DIR/config.json" ]] || {
    echo "Missing config file: $ROOT_DIR/config.json"
    exit 1
  }
  [[ -f "$ROOT_DIR/.env" ]] || {
    echo "Missing env file: $ROOT_DIR/.env"
    exit 1
  }

  load_runtime_overrides

  if ! docker info >/dev/null 2>&1; then
    echo "Cannot access Docker daemon."
    exit 1
  fi

  echo "Docker OK: $(docker --version)"
  echo "Compose OK: $(docker compose version --short)"
  echo "Image tag: ${IMAGE_TAG}"
  echo "Backend image: ${BACKEND_IMAGE}"
  echo "Worker image: ${BACKEND_IMAGE} (shared backend image)"
  echo "Dashboard image: ${DASHBOARD_IMAGE}"
  echo "Data root: ${TARGET_DIRECTORY}"
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

prepare_target_directory() {
  mkdir -p "$TARGET_DIRECTORY/postgres"
  mkdir -p "$TARGET_DIRECTORY/redis"
  mkdir -p "$TARGET_DIRECTORY/raw"
  mkdir -p "$TARGET_DIRECTORY/datasets"
}

config_hash_state_file() {
  echo "$RUN_STATE_DIR/config-hash-$1"
}

tracked_config_hash() {
  local relative_path absolute_path child relative_child

  for relative_path in "$@"; do
    absolute_path="$ROOT_DIR/$relative_path"

    if [[ -f "$absolute_path" ]]; then
      printf 'file %s ' "$relative_path"
      sha256sum "$absolute_path" | awk '{print $1}'
      continue
    fi

    if [[ -d "$absolute_path" ]]; then
      printf 'dir %s\n' "$relative_path"
      while IFS= read -r -d '' child; do
        relative_child="${child#$ROOT_DIR/}"
        printf 'file %s ' "$relative_child"
        sha256sum "$child" | awk '{print $1}'
      done < <(find "$absolute_path" -type f -print0 | sort -z)
      continue
    fi

    printf 'missing %s\n' "$relative_path"
  done | sha256sum | awk '{print $1}'
}

restart_services_with_changed_configs() {
  mkdir -p "$RUN_STATE_DIR"

  local entry service paths hash_file current_hash previous_hash
  for entry in "${TRACKED_BIND_MOUNT_CONFIGS[@]}"; do
    service="${entry%%:*}"
    paths="${entry#*:}"
    hash_file="$(config_hash_state_file "$service")"

    # shellcheck disable=SC2086
    current_hash="$(tracked_config_hash $paths)"
    previous_hash=""
    if [[ -f "$hash_file" ]]; then
      previous_hash="$(tr -d '\r\n' < "$hash_file")"
    fi

    if container_running "$service"; then
      if [[ -z "$previous_hash" ]]; then
        echo "[config] ${paths} hash state missing — restarting ${service}"
        compose_cmd restart "$service"
      elif [[ "$previous_hash" != "$current_hash" ]]; then
        echo "[config] ${paths} changed since last up — restarting ${service}"
        compose_cmd restart "$service"
      fi
    fi

    printf '%s\n' "$current_hash" > "$hash_file"
  done
}

up_stack() {
  check_prereqs
  local http_base
  http_base="$(public_http_base)"

  prepare_target_directory

  echo "[docker] Pulling registry images"
  docker pull "$BACKEND_IMAGE"
  docker pull "$DASHBOARD_IMAGE"

  echo "[compose] Pulling base images"
  compose_cmd pull postgres redis proxy mediamtx

  echo "[compose] Starting stack without server-side builds"
  compose_cmd up -d --no-build --remove-orphans "${COMPOSE_SERVICES[@]}"

  restart_services_with_changed_configs

  wait_for_healthy postgres
  wait_for_healthy redis
  wait_for_healthy backend
  wait_for_healthy dashboard
  wait_for_healthy proxy
  wait_for_running worker
  wait_for_running mediamtx

  echo
  echo "EgoFlow stack is ready."
  echo "Backend health: ${http_base}/api/v1/health"
  echo "Swagger UI:     ${http_base}/api-docs"
  echo "Dashboard:      ${http_base}"
  echo "RTMP ingest:    rtmp://localhost:1935/live"
  echo "RTMPS ingest:   rtmps://localhost:1936/live"
  echo "HLS output:     http://localhost:8888/live/{repo}/{recordingSessionId}/index.m3u8?ticket={playback_ticket}"
}

cmd="${1:-}"
case "$cmd" in
  up)
    up_stack
    ;;
  ps)
    check_prereqs
    compose_cmd ps
    ;;
  logs)
    shift || true
    check_prereqs
    compose_cmd logs -f --tail=200 "$@"
    ;;
  down)
    check_prereqs
    compose_cmd down --remove-orphans
    ;;
  *)
    usage
    exit 1
    ;;
esac
