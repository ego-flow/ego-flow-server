# EgoFlow Server

Docker-first full stack for EgoFlow.

This repository packages the API server, dashboard, background worker, and supporting infrastructure into a single Docker Compose workflow. Standard local usage does not require a host-side Node.js installation.

## What Runs

- PostgreSQL
- Redis
- Express + TypeScript backend API
- TanStack Start dashboard
- BullMQ worker
- MediaMTX

## Prerequisites

- Docker Engine
- Docker Compose v2 plugin

Verify your environment:

```bash
cd ego-flow-server
./scripts/dev.sh doctor
```

If you are on Ubuntu and do not have Docker installed yet, an optional helper is included:

```bash
./scripts/dev.sh install-docker
```

After installation, restart your terminal session before retrying Docker commands.

## Quick Start

Clone the repository and start the full stack:

```bash
cd ego-flow-server
./scripts/dev.sh up
```

When startup completes, these endpoints should be available:

- API health: `http://127.0.0.1:3000/api/v1/health`
- Dashboard: `http://127.0.0.1:8088`
- Live monitor: `http://127.0.0.1:8088/live`
- RTMP ingest: `rtmp://127.0.0.1:1935/live`
- HLS output: `http://127.0.0.1:8888`

Default seeded dashboard login:

- id: `admin`
- password: `changeme123` unless `ADMIN_DEFAULT_PASSWORD` is overridden

## Common Commands

```bash
./scripts/dev.sh up
./scripts/dev.sh doctor
./scripts/dev.sh ps
./scripts/dev.sh logs
./scripts/dev.sh logs backend
./scripts/dev.sh down
./scripts/dev.sh reset
```

Command summary:

- `up`: checks Docker, builds images, and starts the full stack
- `doctor`: validates Docker, Compose, daemon access, and compose file presence
- `ps`: shows current compose service status
- `logs [service]`: follows logs for the whole stack or a single service
- `down`: stops and removes the compose stack
- `reset`: removes containers, volumes, and local Redis/raw/datasets bind-mount data
- `install-docker`: Ubuntu-only Docker installer helper

## How Startup Works

`./scripts/dev.sh up` starts all services defined in `docker-compose.yml`:

- `postgres`
- `redis`
- `backend`
- `worker`
- `dashboard`
- `mediamtx`

The backend container performs database migration and seed work before starting the API process. The worker uses the same image as the backend but runs the queue processor entrypoint instead. The dashboard uses its own multi-stage Node image and serves the built TanStack Start app on port `8088`.

## Dashboard Capabilities

The current dashboard exposes these flows:

- `/login`: JWT login
- `/videos`: processed video list with filter/sort UI
- `/videos/:videoId`: playback, processing status, and delete action
- `/live`: active stream list with HLS playback
- `/admin/users`: admin-only user creation, password reset, and deactivation
- `/admin/settings`: admin-only target directory management

## Persistence

Persistent data is stored through Docker volumes and bind mounts:

- PostgreSQL uses a named Docker volume
- Redis stores append-only data under `./data/redis`
- Raw media is mounted from `./data/raw`
- Generated datasets are mounted from `./data/datasets`

`./scripts/dev.sh reset` is destructive and should only be used when you want to wipe local state.

## Repository Layout

- `backend/`: API server and worker source
- `frontend/`: dashboard source and production runtime wrapper
- `scripts/`: local development and operations helpers
- `guide/`: implementation guide, roadmap, and API specification
- `docker-compose.yml`: full local stack definition

## Development Notes

- The default workflow is Docker-first
- Code changes are picked up by rebuilding with `./scripts/dev.sh up`
- Standard usage does not depend on local `npm install` or any local `.env` bootstrap

## Related Documentation

- [Implementation guide](./guide/EgoFlow_IMPLEMENTATION_GUIDE.md)
- [Task roadmap](./guide/EgoFlow_TASK_ROADMAP.md)
- [API specification](./guide/EgoFlow_API_SPEC.md)
