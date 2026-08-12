#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as your normal user, not root."
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "This installer is intended for Ubuntu."
    echo "Current distro: ${PRETTY_NAME:-unknown}"
    exit 1
  fi
fi

echo "[1/4] Installing docker engine and compose plugin..."
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2

echo "[2/4] Enabling docker service..."
sudo systemctl enable --now docker

echo "[3/4] Adding current user to docker group..."
sudo usermod -aG docker "$USER"

echo "[4/4] Installation complete."
echo "Please re-login (or restart terminal/session) so docker group membership is applied."
echo "Then verify with: docker info"
