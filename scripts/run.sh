#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE_FILE="$ROOT_DIR/compose.yml"
COMPOSE_SERVICES=(postgres redis backend worker dashboard proxy mediamtx)
RUN_STATE_DIR="$ROOT_DIR/.run"
TARGET_DIRECTORY_STATE_FILE="$RUN_STATE_DIR/target-directory"
FILE_MOVE_HELPER_IMAGE="redis:7-alpine"

cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run.sh up               # Check prerequisites, build, and start the stack
  ./scripts/run.sh doctor           # Check Docker / Compose prerequisites
  ./scripts/run.sh ps               # Show compose service status
  ./scripts/run.sh logs [service]   # Follow compose logs
  ./scripts/run.sh down             # Stop and remove the compose stack
  ./scripts/run.sh reset            # Remove containers, volumes, and bind-mount data
  ./scripts/run.sh install-docker   # Ubuntu helper for Docker installation

Notes:
  - The current stack uses a single compose.yml file for both local machines and remote servers.
  - config.json and .env are required before starting the stack.
  - PUBLIC_HTTP_PORT fronts both the API and dashboard through the reverse proxy.
  - TARGET_DIRECTORY is the host data root. The stack uses TARGET_DIRECTORY/{postgres,redis,raw,datasets}.
  - reset is destructive and intended for disposable development/test environments only.
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
  docker compose -f "$COMPOSE_BASE_FILE" "$@"
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

try_normalize_target_directory() {
  local configured_value="$1"

  case "$configured_value" in
    "~")
      if [[ -z "${HOME:-}" ]]; then
        echo "TARGET_DIRECTORY uses ~ but HOME is not set." >&2
        return 1
      fi
      echo "$HOME"
      return
      ;;
    "~/"*)
      if [[ -z "${HOME:-}" ]]; then
        echo "TARGET_DIRECTORY uses ~ but HOME is not set." >&2
        return 1
      fi
      echo "${HOME}/${configured_value#"~/"}"
      return
      ;;
    /*)
      echo "$configured_value"
      return
      ;;
  esac

  echo "TARGET_DIRECTORY must be an absolute path or use ~/... shorthand." >&2
  return 1
}

normalize_target_directory() {
  local normalized_value

  if normalized_value="$(try_normalize_target_directory "$1")"; then
    echo "$normalized_value"
    return
  fi

  exit 1
}

load_runtime_overrides() {
  export PUBLIC_HTTP_PORT
  export RTMP_PORT
  export RTMPS_PORT
  export HLS_PORT
  export TARGET_DIRECTORY
  export HOST_HOME

  PUBLIC_HTTP_PORT="$(read_config_number "PUBLIC_HTTP_PORT" "80")"
  RTMP_PORT="$(read_config_number "RTMP_PORT" "1935")"
  RTMPS_PORT="$(read_config_number "RTMPS_PORT" "1936")"
  HLS_PORT="$(read_config_number "HLS_PORT" "8888")"
  TARGET_DIRECTORY="$(normalize_target_directory "$(read_config_string "TARGET_DIRECTORY")")"
  HOST_HOME="${HOME:-}"
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

  load_runtime_overrides

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
  echo "HTTP port: ${PUBLIC_HTTP_PORT}"
  echo "RTMP port: ${RTMP_PORT}"
  echo "RTMPS port: ${RTMPS_PORT}"
  echo "HLS port: ${HLS_PORT}"
  echo "Data root: ${TARGET_DIRECTORY}"
  echo "Datasets dir: ${TARGET_DIRECTORY}/datasets"
}

is_nested_path() {
  local parent="${1%/}/"
  local child="${2%/}/"

  [[ "$child" == "$parent"* && "$child" != "$parent" ]]
}

directory_is_empty() {
  local dir="$1"
  local entries=()

  shopt -s dotglob nullglob
  entries=("$dir"/*)
  shopt -u dotglob nullglob

  [[ ${#entries[@]} -eq 0 ]]
}

read_persisted_target_directory() {
  local raw_value normalized_value

  if [[ ! -f "$TARGET_DIRECTORY_STATE_FILE" ]]; then
    return
  fi

  raw_value="$(tr -d '\r\n' < "$TARGET_DIRECTORY_STATE_FILE")"
  if [[ -z "$raw_value" ]]; then
    return
  fi

  if normalized_value="$(try_normalize_target_directory "$raw_value" 2>/dev/null)"; then
    echo "$normalized_value"
    return
  fi

  echo "[storage] Ignoring invalid target directory state file: ${TARGET_DIRECTORY_STATE_FILE}" >&2
}

persist_target_directory_state() {
  mkdir -p "$RUN_STATE_DIR"
  printf '%s\n' "$TARGET_DIRECTORY" > "$TARGET_DIRECTORY_STATE_FILE"
}

show_target_directory_status() {
  local previous_target=""

  previous_target="$(read_persisted_target_directory)"

  echo "Current target directory: ${TARGET_DIRECTORY}"
  echo "Previous target directory: ${previous_target}"
}

move_path() {
  local source_path="$1"
  local destination_path="$2"
  local move_output=""
  local helper_destination=""

  if move_output="$(mv "$source_path" "$destination_path" 2>&1)"; then
    return
  fi

  if [[ -d "$source_path" ]]; then
    helper_destination="${destination_path}.migrate-tmp.$$"
    mkdir -p "$helper_destination"
    echo "[storage] Falling back to Docker-assisted directory copy for ${source_path}" >&2

    if docker run --rm \
      -v "$source_path:/from" \
      -v "$helper_destination:/to" \
      --entrypoint /bin/sh \
      "$FILE_MOVE_HELPER_IMAGE" \
      -c 'set -eu; cp -a /from/. /to/; find /from -mindepth 1 -maxdepth 1 -exec rm -rf {} +' >/dev/null; then
      mv "$helper_destination" "$destination_path"
      rmdir "$source_path" 2>/dev/null || true
      return
    fi
  fi

  echo "$move_output" >&2
  exit 1
}

remove_directory_tree() {
  local target_path="$1"
  local remove_output=""

  if [[ ! -e "$target_path" ]]; then
    return
  fi

  if remove_output="$(rm -rf "$target_path" 2>&1)"; then
    return
  fi

  if [[ -d "$target_path" ]]; then
    echo "[storage] Falling back to Docker-assisted directory cleanup for ${target_path}" >&2

    if docker run --rm \
      -v "$target_path:/target" \
      --entrypoint /bin/sh \
      "$FILE_MOVE_HELPER_IMAGE" \
      -c 'set -eu; find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} +' >/dev/null; then
      rmdir "$target_path"
      return
    fi
  fi

  echo "$remove_output" >&2
  exit 1
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

migrate_previous_data_root_if_needed() {
  local previous_data_root=""
  local destination_path source_path
  local entries=()

  previous_data_root="$(read_persisted_target_directory)"

  if [[ -z "$previous_data_root" ]]; then
    echo "[storage] No previous target directory recorded. Skipping migration."
    return
  fi

  if [[ "$previous_data_root" == "$TARGET_DIRECTORY" ]]; then
    echo "[storage] Previous target directory matches current target. Skipping migration."
    return
  fi

  if [[ ! -d "$previous_data_root" ]]; then
    echo "[storage] Previous target directory from state file does not exist on disk: ${previous_data_root}"
    echo "[storage] Skipping host data migration."
    return
  fi

  if is_nested_path "$previous_data_root" "$TARGET_DIRECTORY" || is_nested_path "$TARGET_DIRECTORY" "$previous_data_root"; then
    echo "target_directory migration cannot move between nested directories."
    exit 1
  fi

  mkdir -p "$TARGET_DIRECTORY"

  shopt -s dotglob nullglob
  entries=("$previous_data_root"/*)
  shopt -u dotglob nullglob

  if [[ ${#entries[@]} -eq 0 ]]; then
    echo "[storage] Previous target directory is empty. Nothing to migrate."
    rmdir "$previous_data_root" 2>/dev/null || true
    return
  fi

  echo "[storage] Migrating host data root from ${previous_data_root} to ${TARGET_DIRECTORY}"

  for source_path in "${entries[@]}"; do
    destination_path="$TARGET_DIRECTORY/$(basename "$source_path")"
    echo "[storage] Moving $(basename "$source_path") -> ${destination_path}"
    if [[ -e "$destination_path" ]]; then
      if [[ -d "$destination_path" ]] && directory_is_empty "$destination_path"; then
        echo "[storage] Removing empty destination placeholder: ${destination_path}"
        rmdir "$destination_path"
      else
        echo "target_directory migration aborted because destination already contains: ${destination_path}"
        exit 1
      fi
    fi
    move_path "$source_path" "$destination_path"
  done

  rmdir "$previous_data_root" 2>/dev/null || true
  echo "[storage] Host data root migration complete."
}

up_stack() {
  check_prereqs
  local http_base
  http_base="$(public_http_base)"

  show_target_directory_status
  migrate_previous_data_root_if_needed
  prepare_target_directory
  persist_target_directory_state

  echo "[compose] Starting stack: ${COMPOSE_SERVICES[*]}"
  compose_cmd up -d --build --remove-orphans "${COMPOSE_SERVICES[@]}"

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
  echo "RTMP ingest:    rtmp://localhost:${RTMP_PORT}/live"
  echo "RTMPS ingest:   rtmps://localhost:${RTMPS_PORT}/live"
  echo "HLS output:     http://localhost:${HLS_PORT}"
}

doctor() {
  check_prereqs
  show_target_directory_status
  echo "Compose file:"
  echo "  - $COMPOSE_BASE_FILE"
  echo "Config file:"
  echo "  - $ROOT_DIR/config.json"
  echo "Env file:"
  echo "  - $ROOT_DIR/.env"
  echo "Target state file:"
  echo "  - $TARGET_DIRECTORY_STATE_FILE"
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

  echo "Warning: reset removes containers, volumes, and all data under TARGET_DIRECTORY."
  echo "Use this only for disposable development/test environments."
  echo "Removing containers and volumes..."
  compose_cmd down -v --remove-orphans

  echo "Removing target directory..."
  remove_directory_tree "$TARGET_DIRECTORY"

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
