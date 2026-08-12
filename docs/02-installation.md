# Installation

This guide covers a self-hosted `ego-flow-server` checkout using the supported
Docker Compose runtime.

## Prerequisites

Required:

- Docker Engine or Docker Desktop
- Docker Compose v2 plugin
- Git
- A host that can bind the fixed runtime ports listed in
  [04-runtime-operations.md](./04-runtime-operations.md)

Node.js is not required to run the Docker Compose stack. It is only needed when
developing the backend or frontend outside Docker.

## Clone

Clone the repository and enter it:

```bash
git clone https://github.com/ego-flow/ego-flow-server.git
cd ego-flow-server
```

For a reproducible deployment, select the current release tag:

```bash
git switch --detach v0.0.1
```

A detached HEAD is expected for a release deployment because the tag is
immutable. Use `git switch main` instead when developing against the latest
source. A separate `v0.0.1` branch is not required.

## Check Host Readiness

Run:

```bash
./scripts/run.sh doctor
```

`doctor` checks Docker, Docker Compose, `config.json`, `.env`, fixed ports, and
target-directory state. On a fresh checkout it will usually report missing
configuration files. Create them before starting the stack.

If Docker is not installed on Ubuntu, use:

```bash
./scripts/run.sh install-docker
```

If Docker exists but the daemon is unavailable, enable the service and make sure
your user can access Docker. After adding yourself to the Docker group, restart
the terminal session before retrying.

## Create Configuration

Run the interactive setup script:

```bash
./scripts/setup-server-config.sh
```

The script creates or overwrites:

- `.env`
- `config.json`

Press Enter at a prompt to accept the displayed default. The most important
value is `TARGET_DIRECTORY`, which must point to a dedicated data root for the
server. See [03-configuration.md](./03-configuration.md) and
[05-storage-and-data.md](./05-storage-and-data.md) before pointing it at an
existing directory.

## Start The Stack

Run:

```bash
./scripts/run.sh up
```

Startup performs prerequisite checks, prepares the target directory, migrates a
previous target directory when configured, builds images, starts all Compose
services, and waits for the core services to become healthy.

When startup finishes, open:

```text
http://{server_host}:80
```

Default seeded dashboard user:

```text
ID: admin
Password: ADMIN_DEFAULT_PASSWORD from .env
```

If you accepted the setup default, the initial password is `changeme123`.

## Verify

Basic checks:

```bash
./scripts/run.sh ps
./scripts/run.sh logs backend
```

HTTP checks:

```bash
curl http://127.0.0.1/api/v1/health
curl -I http://127.0.0.1/api-docs/
```

The health endpoint should return `{"status":"ok"}`. Swagger UI is available at
`/api-docs/` after the backend is healthy.
