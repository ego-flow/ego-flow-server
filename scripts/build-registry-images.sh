#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REGISTRY="${REGISTRY:-ghcr.io}"
REGISTRY_OWNER="${REGISTRY_OWNER:-dennis0405}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ego-flow-server}"
IMAGE_TAG="${IMAGE_TAG:-}"
PLATFORM="${PLATFORM:-linux/amd64}"
CONFIG_FILE="${CONFIG_FILE:-$ROOT_DIR/config.json}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-}"
VITE_BACKEND_ORIGIN="${VITE_BACKEND_ORIGIN:-}"
PUSH_LATEST="${PUSH_LATEST:-1}"
LOGIN_WITH_GH=0
PUSH_IMAGES=1

usage() {
  cat <<'EOF'
Usage:
  ./scripts/build-registry-images.sh [options]

Builds registry images for remote servers and pushes them to GHCR by default.
Local .env and config.json are only read; they are never modified.

Options:
  --tag TAG                  Image tag. Defaults to current git short SHA.
  --owner OWNER              Registry owner. Defaults to dennis0405.
  --registry REGISTRY        Registry host. Defaults to ghcr.io.
  --prefix PREFIX            Image name prefix. Defaults to ego-flow-server.
  --platform PLATFORM        Docker target platform. Defaults to linux/amd64.
  --config-file PATH         Remote server config.json to read. Defaults to ./config.json.
  --env-file PATH            Remote server .env to read. Defaults to ./.env.
  --public-origin URL        Public origin for the remote server, e.g. http://13.209.88.203.
  --vite-api-base-url URL    Frontend API base URL. Defaults to env file VITE_API_BASE_URL or /api/v1.
  --vite-backend-origin URL  Frontend backend origin. Defaults to --public-origin or env file value.
  --no-latest                Do not also tag/push latest.
  --no-push                  Build locally without pushing.
  --login                    Login to the registry with `gh auth token`.
  -h, --help                 Show this help.

Examples:
  ./scripts/build-registry-images.sh --login --public-origin http://13.209.88.203
  ./scripts/build-registry-images.sh --tag main-20260522 --config-file ./config.remote.json --env-file ./.env.remote
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

default_tag() {
  git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null || date +%Y%m%d%H%M%S
}

read_env_value() {
  local key="$1"
  local file="$2"

  [[ -f "$file" ]] || return 0

  awk -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && index($0, "=") > 0 {
      split($0, parts, "=")
      name=parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) {
        value=substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        gsub(/^"|"$/, "", value)
        gsub(/^'\''|'\''$/, "", value)
        print value
      }
    }
  ' "$file" | tail -n 1
}

read_config_number() {
  local key="$1"
  local default_value="$2"
  local file="$3"
  local value

  [[ -f "$file" ]] || {
    echo "$default_value"
    return
  }

  value="$(
    node -e '
      const fs = require("node:fs");
      const [file, key] = process.argv.slice(1);
      const value = JSON.parse(fs.readFileSync(file, "utf8"))[key];
      if (Number.isFinite(Number(value))) process.stdout.write(String(Number(value)));
    ' "$file" "$key"
  )"

  if [[ -n "$value" ]]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

remote_origin_from_files() {
  local env_file="$1"
  local config_file="$2"
  local host scheme port port_suffix

  host="$(read_env_value PUBLIC_HOST "$env_file")"
  if [[ -z "$host" ]]; then
    host="$(read_env_value SERVER_HOST "$env_file")"
  fi
  [[ -n "$host" ]] || return 0

  scheme="$(read_env_value PUBLIC_SCHEME "$env_file")"
  [[ -n "$scheme" ]] || scheme="http"

  port="$(read_config_number PUBLIC_HTTP_PORT 80 "$config_file")"
  port_suffix=""
  if [[ "$scheme" == "http" && "$port" != "80" ]]; then
    port_suffix=":$port"
  elif [[ "$scheme" == "https" && "$port" != "443" ]]; then
    port_suffix=":$port"
  fi

  echo "${scheme}://${host}${port_suffix}"
}

docker_login_with_gh() {
  require_cmd gh
  echo "[auth] Logging in to ${REGISTRY} as ${REGISTRY_OWNER} with gh auth token"
  gh auth token | docker login "$REGISTRY" -u "$REGISTRY_OWNER" --password-stdin
}

docker_build() {
  docker build --platform "$PLATFORM" "$@"
}

docker_push_tag() {
  local image="$1"

  if [[ "$PUSH_IMAGES" == "1" ]]; then
    docker push "$image"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --owner)
      REGISTRY_OWNER="${2:-}"
      shift 2
      ;;
    --registry)
      REGISTRY="${2:-}"
      shift 2
      ;;
    --prefix)
      IMAGE_PREFIX="${2:-}"
      shift 2
      ;;
    --platform)
      PLATFORM="${2:-}"
      shift 2
      ;;
    --config-file)
      CONFIG_FILE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --public-origin)
      PUBLIC_ORIGIN="${2:-}"
      shift 2
      ;;
    --vite-api-base-url)
      VITE_API_BASE_URL="${2:-}"
      shift 2
      ;;
    --vite-backend-origin)
      VITE_BACKEND_ORIGIN="${2:-}"
      shift 2
      ;;
    --no-latest)
      PUSH_LATEST=0
      shift
      ;;
    --no-push)
      PUSH_IMAGES=0
      shift
      ;;
    --login)
      LOGIN_WITH_GH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

require_cmd docker
require_cmd node

[[ -n "$REGISTRY_OWNER" ]] || fail "Registry owner is blank."
[[ -n "$IMAGE_PREFIX" ]] || fail "Image prefix is blank."
[[ -n "$PLATFORM" ]] || fail "Platform is blank."

if [[ -z "$IMAGE_TAG" ]]; then
  IMAGE_TAG="$(default_tag)"
fi

if [[ -f "$ENV_FILE" ]]; then
  if [[ -z "$VITE_API_BASE_URL" ]]; then
    VITE_API_BASE_URL="$(read_env_value VITE_API_BASE_URL "$ENV_FILE")"
  fi
  if [[ -z "$VITE_BACKEND_ORIGIN" ]]; then
    VITE_BACKEND_ORIGIN="$(read_env_value VITE_BACKEND_ORIGIN "$ENV_FILE")"
  fi
fi

if [[ -z "$PUBLIC_ORIGIN" ]]; then
  PUBLIC_ORIGIN="$(remote_origin_from_files "$ENV_FILE" "$CONFIG_FILE")"
fi

if [[ -z "$VITE_BACKEND_ORIGIN" ]]; then
  VITE_BACKEND_ORIGIN="$PUBLIC_ORIGIN"
fi

if [[ -z "$VITE_API_BASE_URL" ]]; then
  VITE_API_BASE_URL="/api/v1"
fi

BACKEND_IMAGE="${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-backend:${IMAGE_TAG}"
DASHBOARD_IMAGE="${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-dashboard:${IMAGE_TAG}"

BACKEND_LATEST="${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-backend:latest"
DASHBOARD_LATEST="${REGISTRY}/${REGISTRY_OWNER}/${IMAGE_PREFIX}-dashboard:latest"

echo "[build] Registry: ${REGISTRY}/${REGISTRY_OWNER}"
echo "[build] Tag: ${IMAGE_TAG}"
echo "[build] Platform: ${PLATFORM}"
echo "[build] Config file: ${CONFIG_FILE}"
echo "[build] Env file: ${ENV_FILE}"
echo "[build] Frontend VITE_API_BASE_URL: ${VITE_API_BASE_URL}"
echo "[build] Frontend VITE_BACKEND_ORIGIN: ${VITE_BACKEND_ORIGIN:-<runtime origin>}"

if [[ "$LOGIN_WITH_GH" == "1" ]]; then
  docker_login_with_gh
fi

echo "[build] Building backend image"
docker_build -f "$ROOT_DIR/backend/Dockerfile" -t "$BACKEND_IMAGE" "$ROOT_DIR/backend"

if [[ "$PUSH_LATEST" == "1" ]]; then
  docker tag "$BACKEND_IMAGE" "$BACKEND_LATEST"
fi

echo "[build] Building dashboard image"
docker_build \
  --build-arg "VITE_API_BASE_URL=${VITE_API_BASE_URL}" \
  --build-arg "VITE_BACKEND_ORIGIN=${VITE_BACKEND_ORIGIN}" \
  -f "$ROOT_DIR/frontend/Dockerfile" \
  -t "$DASHBOARD_IMAGE" \
  "$ROOT_DIR/frontend"

if [[ "$PUSH_LATEST" == "1" ]]; then
  docker tag "$DASHBOARD_IMAGE" "$DASHBOARD_LATEST"
fi

docker_push_tag "$BACKEND_IMAGE"
docker_push_tag "$DASHBOARD_IMAGE"

if [[ "$PUSH_LATEST" == "1" ]]; then
  docker_push_tag "$BACKEND_LATEST"
  docker_push_tag "$DASHBOARD_LATEST"
fi

cat <<EOF

[done] Images are ready:
  BACKEND_IMAGE=${BACKEND_IMAGE}
  DASHBOARD_IMAGE=${DASHBOARD_IMAGE}

Remote server can run:
  IMAGE_TAG=${IMAGE_TAG} ./scripts/run-registry.sh up
EOF
