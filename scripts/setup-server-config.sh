#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/setup-server-config.sh

Creates or overwrites .env and config.json by asking for each value in the terminal.
Press Enter at any prompt to use the shown default.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      # Accepted for compatibility. Existing files are overwritten by default.
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -t 0 ]]; then
  echo "This setup script must be run from an interactive terminal." >&2
  exit 1
fi

detect_ec2_public_ipv4() {
  local token

  if ! command -v curl >/dev/null 2>&1; then
    return
  fi

  token="$(
    curl -fsS --max-time 1 \
      -X PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true
  )"

  if [[ -n "$token" ]]; then
    curl -fsS --max-time 1 \
      -H "X-aws-ec2-metadata-token: ${token}" \
      "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true
    return
  fi

  curl -fsS --max-time 1 "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true
}

detect_server_ip() {
  local detected

  detected="$(detect_ec2_public_ipv4)"
  if [[ -n "$detected" ]]; then
    echo "$detected"
    return
  fi

  echo "127.0.0.1"
}

http_origin_for() {
  local host="$1"

  echo "http://${host}"
}

generate_jwt_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 64
    return
  fi

  od -An -N64 -tx1 /dev/urandom | tr -d ' \n'
  printf '\n'
}

ask_with_default() {
  local name="$1"
  local default_value="$2"
  local format="$3"
  local value

  read -r -p "${name} [default: ${default_value}] (${format}): " value
  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

ask_secret_with_default() {
  local name="$1"
  local default_value="$2"
  local format="$3"
  local value

  read -r -s -p "${name} [default: ${default_value}] (${format}): " value
  echo >&2
  if [[ -z "$value" ]]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

ask_secret_generated_default() {
  local name="$1"
  local generated_value="$2"
  local format="$3"
  local value

  read -r -s -p "${name} [default: generate random secret] (${format}): " value
  echo >&2
  if [[ -z "$value" || "$value" == "generate" ]]; then
    printf '%s' "$generated_value"
  else
    printf '%s' "$value"
  fi
}

ask_optional_value() {
  local name="$1"
  local format="$2"
  local value

  read -r -p "${name} [default: omit] (${format}; blank to omit): " value
  printf '%s' "$value"
}

ask_secret_optional_value() {
  local name="$1"
  local format="$2"
  local value

  read -r -s -p "${name} [default: omit] (${format}; blank to omit): " value
  echo >&2
  printf '%s' "$value"
}

is_positive_int() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" > 0 ))
}

validate_target_directory() {
  case "$1" in
    "~" | "~/"* | /*)
      return
      ;;
  esac

  echo "TARGET_DIRECTORY must be an absolute path or use ~/... shorthand." >&2
  exit 1
}

validate_boolean() {
  case "$2" in
    true | false)
      return
      ;;
  esac

  echo "${1} must be true or false." >&2
  exit 1
}

validate_rtmps_mode() {
  case "$1" in
    "" | no | optional | strict)
      return
      ;;
  esac

  echo "RTMPS_ENCRYPTION_MODE must be blank, no, optional, or strict." >&2
  exit 1
}

dotenv_value() {
  local value="$1"

  if [[ "$value" =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then
    printf '%s' "$value"
    return
  fi

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

json_string() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '"%s"' "$value"
}

write_env_file() {
  local tmp_file="$1"

  {
    printf 'ADMIN_DEFAULT_PASSWORD=%s\n' "$(dotenv_value "$ADMIN_DEFAULT_PASSWORD")"
    printf 'JWT_SECRET=%s\n' "$(dotenv_value "$JWT_SECRET")"
    printf '\n'
    printf '# PostgreSQL\n'
    printf 'POSTGRES_USER=%s\n' "$(dotenv_value "$POSTGRES_USER")"
    printf 'POSTGRES_PASSWORD=%s\n' "$(dotenv_value "$POSTGRES_PASSWORD")"
    printf 'POSTGRES_DB=%s\n' "$(dotenv_value "$POSTGRES_DB")"
    printf '\n'
    if [[ -n "$HF_TOKEN" ]]; then
      printf 'HF_TOKEN=%s\n' "$(dotenv_value "$HF_TOKEN")"
    else
      printf '# HF_TOKEN=\n'
    fi
    printf '\n'
    printf '# Enable these only when local RTMPS cert/key are prepared under ./certs\n'
    if [[ -n "$RTMPS_ENCRYPTION_MODE" ]]; then
      printf 'RTMPS_ENCRYPTION_MODE=%s\n' "$(dotenv_value "$RTMPS_ENCRYPTION_MODE")"
      printf 'RTMPS_CERT_PATH=%s\n' "$(dotenv_value "$RTMPS_CERT_PATH")"
      printf 'RTMPS_KEY_PATH=%s\n' "$(dotenv_value "$RTMPS_KEY_PATH")"
    else
      printf '# RTMPS_ENCRYPTION_MODE=strict\n'
      printf '# RTMPS_CERT_PATH=/certs/server.crt\n'
      printf '# RTMPS_KEY_PATH=/certs/server.key\n'
    fi
  } > "$tmp_file"
}

write_config_file() {
  local tmp_file="$1"

  {
    printf '{\n'
    printf '  "TARGET_DIRECTORY": %s,\n' "$(json_string "$TARGET_DIRECTORY")"
    printf '  "CORS_ORIGIN": %s,\n' "$(json_string "$CORS_ORIGIN")"
    printf '  "WORKER_CONCURRENCY": %s,\n' "$WORKER_CONCURRENCY"
    printf '  "DELETE_RAW_AFTER_PROCESSING": %s,\n' "$DELETE_RAW_AFTER_PROCESSING"
    printf '  "JWT_EXPIRES_IN": %s,\n' "$(json_string "$JWT_EXPIRES_IN")"
    printf '  "JWT_REFRESH_THRESHOLD_SECONDS": %s,\n' "$JWT_REFRESH_THRESHOLD_SECONDS"
    printf '  "SIGNED_FILE_URL_EXPIRES_IN": %s\n' "$(json_string "$SIGNED_FILE_URL_EXPIRES_IN")"
    printf '}\n'
  } > "$tmp_file"
}

main() {
  local server_ip default_cors_origin generated_jwt_secret

  server_ip="$(detect_server_ip)"
  generated_jwt_secret="$(generate_jwt_secret)"

  echo "EgoFlow server config setup"
  echo "Repository: $ROOT_DIR"
  echo "Detected server IP for defaults: ${server_ip}"
  echo
  echo "Existing .env and config.json will be overwritten."
  echo "Press Enter to use a default, or type a custom value."
  echo

  echo "[config.json]"
  TARGET_DIRECTORY="$(ask_with_default "TARGET_DIRECTORY" "~/ego-flow/ego-flow-data" "absolute path or ~/...")"
  default_cors_origin="$(http_origin_for "$server_ip")"
  CORS_ORIGIN="$(ask_with_default "CORS_ORIGIN" "$default_cors_origin" "origin URL or *, e.g. http://${server_ip}")"
  WORKER_CONCURRENCY="$(ask_with_default "WORKER_CONCURRENCY" "2" "positive integer")"
  DELETE_RAW_AFTER_PROCESSING="$(ask_with_default "DELETE_RAW_AFTER_PROCESSING" "true" "true or false")"
  JWT_EXPIRES_IN="$(ask_with_default "JWT_EXPIRES_IN" "24h" "duration string, e.g. 24h")"
  JWT_REFRESH_THRESHOLD_SECONDS="$(ask_with_default "JWT_REFRESH_THRESHOLD_SECONDS" "21600" "seconds, e.g. 21600")"
  SIGNED_FILE_URL_EXPIRES_IN="$(ask_with_default "SIGNED_FILE_URL_EXPIRES_IN" "6h" "duration string, e.g. 6h")"

  echo
  echo "[.env]"
  ADMIN_DEFAULT_PASSWORD="$(ask_secret_with_default "ADMIN_DEFAULT_PASSWORD" "changeme123" "password string")"
  JWT_SECRET="$(ask_secret_generated_default "JWT_SECRET" "$generated_jwt_secret" "min 16 chars, or type generate")"
  POSTGRES_USER="$(ask_with_default "POSTGRES_USER" "postgres" "PostgreSQL username")"
  POSTGRES_PASSWORD="$(ask_secret_with_default "POSTGRES_PASSWORD" "postgres" "PostgreSQL password")"
  POSTGRES_DB="$(ask_with_default "POSTGRES_DB" "egoflow" "PostgreSQL database name")"
  HF_TOKEN="$(ask_secret_optional_value "HF_TOKEN" "Hugging Face token, e.g. hf_xxx")"
  RTMPS_ENCRYPTION_MODE="$(ask_optional_value "RTMPS_ENCRYPTION_MODE" "no, optional, or strict")"
  if [[ -n "$RTMPS_ENCRYPTION_MODE" ]]; then
    RTMPS_CERT_PATH="$(ask_with_default "RTMPS_CERT_PATH" "/certs/server.crt" "container path, e.g. /certs/server.crt")"
    RTMPS_KEY_PATH="$(ask_with_default "RTMPS_KEY_PATH" "/certs/server.key" "container path, e.g. /certs/server.key")"
  else
    RTMPS_CERT_PATH=""
    RTMPS_KEY_PATH=""
  fi

  validate_target_directory "$TARGET_DIRECTORY"
  validate_boolean "DELETE_RAW_AFTER_PROCESSING" "$DELETE_RAW_AFTER_PROCESSING"
  validate_rtmps_mode "$RTMPS_ENCRYPTION_MODE"

  if ! is_positive_int "$WORKER_CONCURRENCY"; then
    echo "WORKER_CONCURRENCY must be a positive integer." >&2
    exit 1
  fi

  if ! is_positive_int "$JWT_REFRESH_THRESHOLD_SECONDS"; then
    echo "JWT_REFRESH_THRESHOLD_SECONDS must be a positive integer." >&2
    exit 1
  fi

  if [[ ${#JWT_SECRET} -lt 16 ]]; then
    echo "JWT_SECRET must be at least 16 characters." >&2
    exit 1
  fi

  env_tmp="$(mktemp "$ROOT_DIR/.env.tmp.XXXXXX")"
  config_tmp="$(mktemp "$ROOT_DIR/config.json.tmp.XXXXXX")"
  trap 'rm -f "$env_tmp" "$config_tmp"' EXIT

  write_env_file "$env_tmp"
  write_config_file "$config_tmp"

  chmod 600 "$env_tmp"
  chmod 644 "$config_tmp"
  mv "$env_tmp" "$ROOT_DIR/.env"
  mv "$config_tmp" "$ROOT_DIR/config.json"
  trap - EXIT

  echo
  echo "Created:"
  echo "  - $ROOT_DIR/.env"
  echo "  - $ROOT_DIR/config.json"
  echo
  echo "Next:"
  echo "  ./scripts/run.sh doctor"
  echo "  ./scripts/run.sh up"
}

main
