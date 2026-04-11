# EgoFlow Server

EgoFlow is a platform for collecting egocentric video from AR glasses and serving it through a backend API, a live/dashboard UI, and a MediaMTX-based streaming stack.

## Getting Started

### Prerequisites

- Docker Engine or Docker Desktop with Docker Compose v2
- Node.js `24+` only if you want to run `npm` directly in `backend/` or `frontend/`

Verify your environment:

```bash
./scripts/run.sh doctor
```

### Configuration

Create `config.json` and `.env` in the `ego-flow-server` root before starting the stack.

```bash
cp ./config.json.example ./config.json
cp ./.env.example ./.env
```

Then update the values for your environment.

### Start the Stack

```bash
./scripts/run.sh up
```

The same command is used on both local machines and remote Linux servers. Startup finishes only after the main service health checks pass.

HTTP access goes through a single public entrypoint:

- `http://localhost` when `PUBLIC_HTTP_PORT` is `80`
- `http://localhost:{PUBLIC_HTTP_PORT}` when you changed the public HTTP port

Using that HTTP base URL, the stack exposes:

- Backend health: `{PUBLIC_HTTP_BASE}/api/v1/health`
- Swagger UI: `{PUBLIC_HTTP_BASE}/api-docs`
- OpenAPI JSON: `{PUBLIC_HTTP_BASE}/api/v1/openapi.json`
- Dashboard: `{PUBLIC_HTTP_BASE}`
- RTMP ingest: `rtmp://localhost:{RTMP_PORT}/live`
- RTMPS ingest: `rtmps://localhost:{RTMPS_PORT}/live`
- HLS output: `http://localhost:{HLS_PORT}`

Current seeded dashboard login:

- ID: `admin`
- Password: `changeme123`

### Refresh a Remote Server Checkout

When the parent `ego-flow` repository is cloned on a remote server, the standard refresh command is:

```bash
./scripts/server-up.sh
```

That helper lives in the parent repository root. It stops the running stack, pulls the latest parent repo commit, updates submodules, and then calls `ego-flow-server/scripts/run.sh up`.

## Published Ports

| Port | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_HTTP_PORT` | `80` | Public HTTP entrypoint for dashboard, API, Swagger UI, OpenAPI JSON, and `/files/*` |
| `RTMP_PORT` | `1935` | RTMP ingest |
| `RTMPS_PORT` | `1936` | Optional RTMPS ingest |
| `HLS_PORT` | `8888` | HLS playback |
| `MEDIAMTX_API_PORT` | `9997` | Internal MediaMTX control API port used inside the Docker network |

## Storage and Target Directory

> Warning: Files under `TARGET_DIRECTORY` that are not related to EgoFlow Server may be removed during server operations.

`TARGET_DIRECTORY` is the host data root that EgoFlow Server uses for all persistent files. Use a dedicated directory for EgoFlow only. The value must resolve to an absolute host path. `~/...` shorthand is supported and expanded to your home directory before the stack starts.

`./scripts/run.sh up` stores the last active host data root in `.run/target-directory`. When `TARGET_DIRECTORY` changes, the script migrates from that previously recorded root before starting Docker Compose, including changes to another absolute host path outside the project tree. If `.run/target-directory` is missing or blank, host data migration is skipped.

Current host layout under `TARGET_DIRECTORY`:

```text
{TARGET_DIRECTORY}/
├── postgres/
├── redis/
├── raw/
└── datasets/
    └── {owner_id}/
        └── {repository_name}/
            ├── {video_id}.mp4
            ├── .dashboard/
            │   └── {video_id}.mp4
            └── .thumbnails/
                └── {video_id}.jpg
```

Generated outputs are stored under `{TARGET_DIRECTORY}/datasets`.

- `{video_id}.mp4` is the processed dataset/VLM video.
- `.dashboard/` stores the dashboard playback copy.
- `.thumbnails/` stores generated preview images.
- Temporary processing files may be created under `{TARGET_DIRECTORY}/datasets/.tmp/` while recordings are being finalized.
- If `TARGET_DIRECTORY` changes, the stack migrates the existing data root when possible and the backend rewrites managed dataset paths on startup.

## Configuration Details

### config.json

Only `TARGET_DIRECTORY` is required and does not have a default. Everything else is optional.

```json
{
  "TARGET_DIRECTORY": "~/ego-flow-data",
  "PUBLIC_HTTP_PORT": 80,
  "RTMP_PORT": 1935,
  "RTMPS_PORT": 1936,
  "HLS_PORT": 8888,
  "MEDIAMTX_API_PORT": 9997,
  "JWT_EXPIRES_IN": "24h",
  "JWT_REFRESH_THRESHOLD_SECONDS": 21600,
  "CORS_ORIGIN": "*",
  "WORKER_CONCURRENCY": 2,
  "DELETE_RAW_AFTER_PROCESSING": true
}
```

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `TARGET_DIRECTORY` | Yes | None | Host data root for postgres, redis, raw recordings, and generated datasets. Must be an absolute path or use `~/...` shorthand. |
| `PUBLIC_HTTP_PORT` | No | `80` | Public HTTP port exposed to users. |
| `RTMP_PORT` | No | `1935` | Port used for RTMP ingest from the app or AR glasses. |
| `RTMPS_PORT` | No | `1936` | Port used for RTMPS ingest when enabled. |
| `HLS_PORT` | No | `8888` | Port used for HLS live playback output. |
| `MEDIAMTX_API_PORT` | No | `9997` | Internal MediaMTX control API port. |
| `JWT_EXPIRES_IN` | No | `24h` | Access-token lifetime. |
| `JWT_REFRESH_THRESHOLD_SECONDS` | No | `21600` | Remaining-token threshold for issuing a refreshed token in responses. |
| `CORS_ORIGIN` | No | `*` | Allowed browser origin for dashboard/API requests. |
| `WORKER_CONCURRENCY` | No | `2` | Number of recording finalize jobs the worker can process in parallel. |
| `DELETE_RAW_AFTER_PROCESSING` | No | `true` | Whether raw recorded segments are deleted after successful post-processing. |

The reverse proxy listens on `PUBLIC_HTTP_PORT` and forwards `/api*`, `/api-docs*`, and `/files*` to the backend while sending all remaining web routes to the dashboard. backend `3000` and dashboard `8088` stay internal to the Docker network.

### .env

`.env` is required for startup because it holds the seeded admin password and JWT signing secret.

```dotenv
ADMIN_DEFAULT_PASSWORD=changeme123
JWT_SECRET=replace-this-in-production

# Optional overrides
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/egoflow?schema=public
REDIS_URL=redis://redis:6379
# HF_TOKEN=

# Optional public URL overrides
# PUBLIC_RTMP_BASE_URL=rtmp://your-host:1935/live
# PUBLIC_HLS_BASE_URL=http://your-host:8888
# RTMPS_ENCRYPTION_MODE=no
# RTMPS_CERT_PATH=/certs/server.crt
# RTMPS_KEY_PATH=/certs/server.key

# Optional internal override for MediaMTX API access
# MEDIAMTX_API_URL=http://mediamtx:9997
```

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `ADMIN_DEFAULT_PASSWORD` | Yes | None | Default password for the seeded admin account. |
| `JWT_SECRET` | Yes | None | Secret key used to sign and verify JWT access tokens. |
| `DATABASE_URL` | No | `postgresql://postgres:postgres@postgres:5432/egoflow?schema=public` | PostgreSQL connection string override. |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection string override. |
| `HF_TOKEN` | No | None | Hugging Face token used for Hugging Face integration. |
| `PUBLIC_RTMP_BASE_URL` | No | `rtmp://127.0.0.1:{RTMP_PORT}/live` | Public RTMP base URL returned to clients. Set it explicitly on any machine that other devices connect to. |
| `PUBLIC_HLS_BASE_URL` | No | `http://127.0.0.1:{HLS_PORT}` | Public HLS base URL returned to clients. Set it explicitly on any machine that other devices connect to. |
| `MEDIAMTX_API_URL` | No | `http://mediamtx:{MEDIAMTX_API_PORT}` | Internal MediaMTX API URL override used by the backend. |
| `RTMPS_ENCRYPTION_MODE` | No | `no` | MediaMTX RTMP encryption mode. |
| `RTMPS_CERT_PATH` | No | `/certs/server.crt` | MediaMTX RTMPS server certificate path. |
| `RTMPS_KEY_PATH` | No | `/certs/server.key` | MediaMTX RTMPS private key path. |

## Commands for run

`./scripts/run.sh` is the supported stack entrypoint for the current Docker Compose runtime.

```bash
./scripts/run.sh up
./scripts/run.sh down
./scripts/run.sh doctor
./scripts/run.sh ps
./scripts/run.sh logs [service]
./scripts/run.sh reset
./scripts/run.sh install-docker
```

Command summary:

- `up`: Checks prerequisites, builds images, starts the full stack, and waits until the main services are ready.
- `down`: Stops and removes the Compose stack.
- `doctor`: Checks Docker, Docker Compose, `config.json`, `.env`, the configured public ports, and prints the previous/current target directory state from `.run/target-directory`.
- `ps`: Shows the current status of Compose services.
- `logs [service]`: Follows logs for the full stack or for a specific service.
- `reset`: Removes containers, volumes, all data under `TARGET_DIRECTORY`, and the persisted `.run/target-directory` state. This is destructive and intended only for disposable development/test environments. If host deletion hits Docker-owned files, the script falls back to Docker-assisted cleanup.
- `install-docker`: Runs the Ubuntu helper script to install Docker and Docker Compose.

## For Developers

If you want to customize or contribute to the project, refer to:

- [Backend development docs](./backend/README.md)
- [Frontend development docs](./frontend/README.md)
- [Project guide](./docs/01.%20project_guide.md)
