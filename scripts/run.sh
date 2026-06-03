#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_BASE_FILE="$ROOT_DIR/compose.yml"
COMPOSE_SERVICES=(postgres redis backend worker dashboard proxy mediamtx)
RUN_STATE_DIR="$ROOT_DIR/.run"
TARGET_DIRECTORY_STATE_FILE="$RUN_STATE_DIR/target-directory"
FILE_MOVE_HELPER_IMAGE="redis:7-alpine"
FIXED_HLS_PORT=8888

# bind-mount config 경로와 그 변경 시 restart 가 필요한 service 매핑.
# `docker compose up -d --build`는 외부 image 를 쓰는 컨테이너의 bind-mount 파일/디렉터리 변경을
# 감지하지 못하므로, 여기서 sha256 을 추적해 변경 시에만 해당 service 를 restart 한다.
TRACKED_BIND_MOUNT_CONFIGS=(
  "proxy:Caddyfile"
  "mediamtx:mediamtx.yml mediamtx-hooks certs"
)

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
  - HTTP port 80 fronts the API and dashboard through the reverse proxy.
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

  if [[ ! -f "$COMPOSE_BASE_FILE" ]]; then
    echo "Missing compose file: $COMPOSE_BASE_FILE"
    exit 1
  fi

  if [[ ! -f "$ROOT_DIR/config.json" ]]; then
    echo "Missing config file: $ROOT_DIR/config.json"
    echo "Run $ROOT_DIR/scripts/setup-server-config.sh before running the stack."
    exit 1
  fi

  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    echo "Missing env file: $ROOT_DIR/.env"
    echo "Run $ROOT_DIR/scripts/setup-server-config.sh before running the stack."
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
  echo "RTMP port: 1935"
  echo "RTMPS port: 1936"
  echo "HLS internal port: ${FIXED_HLS_PORT}"
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

  echo "Previous target directory: ${previous_target}"
  echo "Current target directory: ${TARGET_DIRECTORY}"
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

    if [[ -n "$previous_hash" && "$previous_hash" != "$current_hash" ]] && container_running "$service"; then
      echo "[config] ${paths} changed since last up — restarting ${service}"
      compose_cmd restart "$service"
    fi

    printf '%s\n' "$current_hash" > "$hash_file"
  done
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
  echo "HLS output:     ${http_base}/hls"
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
  echo "It also clears the persisted target-directory state used for future migration detection."
  echo "Use this only for disposable development/test environments."
  echo "Removing containers and volumes..."
  compose_cmd down -v --remove-orphans

  echo "Removing target directory..."
  remove_directory_tree "$TARGET_DIRECTORY"

  echo "Clearing persisted target-directory state..."
  rm -f "$TARGET_DIRECTORY_STATE_FILE"
  for entry in "${TRACKED_BIND_MOUNT_CONFIGS[@]}"; do
    rm -f "$(config_hash_state_file "${entry%%:*}")"
  done
  rmdir "$RUN_STATE_DIR" 2>/dev/null || true

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
