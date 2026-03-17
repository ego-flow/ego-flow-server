#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

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
