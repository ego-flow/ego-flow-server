# EgoFlow Server

EgoFlow is a pipeline that helps teams collect egocentric video datasets from smart glasses and reuse those videos in research workflows. It covers capture, live ingestion, recording, processing, storage, dashboard review, and Python-side dataset access.

`ego-flow-server` is the server-side part of that pipeline. It receives streams from the EgoFlow app, authenticates publish and playback requests, records raw media through MediaMTX, processes recordings into dataset-ready files, stores metadata, serves the dashboard and API, and exposes collected videos for downstream clients.

Current release: `v0.0.1`

- [Documentation](./docs/README.md)
- [Changelog](./CHANGELOG.md)
- [MIT License](./LICENSE)

## Getting Started

### Prerequisites

- Git
- Bash
- Docker Engine or Docker Desktop with Docker Compose v2

### Checkout the Current Release

Clone the repository and select the immutable release tag:

```bash
git clone https://github.com/ego-flow/ego-flow-server.git
cd ego-flow-server
git switch --detach v0.0.1
```

A detached HEAD is expected for a release deployment. Use `git switch main`
instead when developing against the latest source.

Verify your environment:

```bash
./scripts/run.sh doctor
```

If Docker is not installed, `doctor` reports a missing Docker command. On Ubuntu, install Docker with:

```bash
./scripts/run.sh install-docker
```

If Docker is installed but the daemon is not reachable, `doctor` prints the commands needed to enable the Docker service and add your user to the Docker group. After changing group membership, restart your terminal session before retrying.

### Configuration

Create `config.json` and `.env` in the `ego-flow-server` root before starting the stack:

```bash
./scripts/setup-server-config.sh
```

The script asks for every `config.json` and `.env` value in order. Press Enter to accept the displayed default. Existing files are overwritten after the prompts complete.

If Docker is available but configuration is missing, `doctor` reports the missing `config.json` or `.env` path and points back to `scripts/setup-server-config.sh`.

### Start the Stack

```bash
./scripts/run.sh up
```

Startup performs these steps:

- checks Docker, Docker Compose, `config.json`, and `.env`, then prints the fixed runtime ports
- normalizes `TARGET_DIRECTORY` and migrates the previous target directory when the configured data root changed
- creates the required `postgres`, `redis`, `raw`, and `datasets` directories under `TARGET_DIRECTORY`
- builds and starts the Docker Compose services
- restarts proxy or MediaMTX services when their bind-mounted config files changed
- waits for Postgres, Redis, backend, dashboard, and proxy health checks, then waits for worker and MediaMTX to be running

Dashboard, API, Swagger UI, file access, and WHIP signaling use the public HTTP
entrypoint:

- `http://{server_host}:80`

Through port `80`, the stack exposes:

- Dashboard: `http://{server_host}:80`
- Backend health: `http://{server_host}:80/api/v1/health`
- Swagger UI for available API endpoints: `http://{server_host}:80/api-docs`
- OpenAPI JSON: `http://{server_host}:80/api/v1/openapi.json`
- WHIP/WebRTC ingest: `http://{server_host}:80/live/{repo}/{recordingSessionId}/whip?ticket={publish_ticket}`

Media-specific host ports expose:

- RTMP ingest: `rtmp://{server_host}:1935/live/{repo}/{recordingSessionId}?ticket={publish_ticket}`
- RTMPS ingest, when enabled: `rtmps://{server_host}:1936/live/{repo}/{recordingSessionId}?ticket={publish_ticket}`
- HLS output: `http://{server_host}:8888/live/{repo}/{recordingSessionId}/index.m3u8?ticket={playback_ticket}`

After startup, open `/api-docs` on the server host to inspect the provided API in Swagger UI.

The app normally obtains `stream_path`, `publish_ticket`, and `playback_ticket` from the backend and builds these URLs from those values.

Seeded dashboard login:

- ID: `admin`
- Password: the `ADMIN_DEFAULT_PASSWORD` value configured during setup. The setup default is `changeme123`.

## Runtime Ports

| Port | Exposure | Purpose |
| --- | --- | --- |
| `80/tcp` | Host | Public HTTP entrypoint for dashboard, API, Swagger UI, OpenAPI JSON, WHIP signaling, and `/files/*` |
| `1935/tcp` | Host | RTMP ingest endpoint for publisher connections |
| `1936/tcp` | Host | Optional RTMPS ingest endpoint for encrypted publisher connections |
| `8189/udp` | Host | WebRTC ICE media endpoint used by WHIP |
| `8888/tcp` | Host | Direct MediaMTX HLS playback endpoint |
| `3000/tcp` | Compose internal | Backend API service |
| `8088/tcp` | Compose internal | Dashboard service |
| `8889/tcp` | Compose internal | MediaMTX WHIP signaling, routed through port `80` |
| `9997/tcp` | Compose internal | MediaMTX control API used by backend |

## Storage and Target Directory

> Warning: Files under `TARGET_DIRECTORY` that are not related to EgoFlow Server may be removed during server operations.

`TARGET_DIRECTORY` is the host data root that EgoFlow Server uses for persistent runtime data. Use a dedicated directory for EgoFlow only. The value must resolve to an absolute host path. `~/...` shorthand is supported and expanded to your home directory before the stack starts.

`./scripts/run.sh up` stores the last active host data root in `.run/target-directory`. When `TARGET_DIRECTORY` changes, the script migrates from that previously recorded root before starting Docker Compose. If `.run/target-directory` is missing or blank, host data migration is skipped.

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

Directory roles:

- `postgres/` stores PostgreSQL data.
- `redis/` stores Redis append-only data.
- `raw/` stores raw MediaMTX recording segments.
- `datasets/` stores generated outputs.
- `{video_id}.mp4` is the processed dataset/VLM video.
- `.dashboard/` stores the dashboard playback copy.
- `.thumbnails/` stores generated preview images.
- Temporary processing files may be created under `datasets/.tmp/` while recordings are being finalized.

If `TARGET_DIRECTORY` changes, the stack migrates the existing data root when possible and the backend rewrites managed dataset paths on startup.

## Configuration Details

### config.json

`setup-server-config.sh` writes every supported `config.json` key. Only `TARGET_DIRECTORY` has no runtime default if the key is missing.

```json
{
  "TARGET_DIRECTORY": "~/ego-flow/ego-flow-data",
  "CORS_ORIGIN": "http://127.0.0.1",
  "WORKER_CONCURRENCY": 2,
  "DELETE_RAW_AFTER_PROCESSING": true,
  "JWT_EXPIRES_IN": "24h",
  "JWT_REFRESH_THRESHOLD_SECONDS": 21600,
  "SIGNED_FILE_URL_EXPIRES_IN": "6h"
}
```

| Key | Required | Setup default | Description |
| --- | --- | --- | --- |
| `TARGET_DIRECTORY` | Yes | `~/ego-flow/ego-flow-data` | Host data root for Postgres, Redis, raw recordings, and generated datasets. Must be an absolute path or use `~/...` shorthand. |
| `CORS_ORIGIN` | No | `http://{detected_server_ip}` | Allowed browser origin for dashboard/API requests. Use `*` only when that is intentional. |
| `WORKER_CONCURRENCY` | No | `2` | Number of recording finalize jobs the worker can process in parallel. |
| `DELETE_RAW_AFTER_PROCESSING` | No | `true` | Whether raw recorded segments are deleted after successful post-processing. |
| `JWT_EXPIRES_IN` | No | `24h` | Access-token lifetime. |
| `JWT_REFRESH_THRESHOLD_SECONDS` | No | `21600` | Remaining-token threshold for issuing a refreshed token in responses. |
| `SIGNED_FILE_URL_EXPIRES_IN` | No | `6h` | Lifetime for signed `/files/*` playback URLs. |

The reverse proxy listens on fixed host port `80` and forwards `/api*`, `/api-docs*`, and `/files*` to the backend. It forwards `/live/{repo}/{recordingSessionId}/whip` to MediaMTX WHIP signaling and sends all remaining web routes to the dashboard. HLS playback is exposed directly through MediaMTX on `8888/tcp`.

### .env

`.env` is required for startup because it holds secrets and database bootstrap values.

```dotenv
ADMIN_DEFAULT_PASSWORD=changeme123
JWT_SECRET=replace-this-in-production

# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=egoflow

# HF_TOKEN=

# Enable these only when local RTMPS cert/key are prepared under ./certs
# RTMPS_ENCRYPTION_MODE=strict
# RTMPS_CERT_PATH=/certs/server.crt
# RTMPS_KEY_PATH=/certs/server.key
```

| Key | Required | Setup default | Description |
| --- | --- | --- | --- |
| `ADMIN_DEFAULT_PASSWORD` | Yes | `changeme123` | Default password for the seeded `admin` dashboard account. |
| `JWT_SECRET` | Yes | generated random secret | Secret key used to sign and verify JWT access tokens. Must be at least 16 characters. |
| `POSTGRES_USER` | Yes | `postgres` | PostgreSQL username used by the Compose stack. |
| `POSTGRES_PASSWORD` | Yes | `postgres` | PostgreSQL password used by the Compose stack. |
| `POSTGRES_DB` | Yes | `egoflow` | PostgreSQL database name used by the Compose stack. |
| `HF_TOKEN` | No | omitted | Hugging Face token used for Hugging Face integration. |
| `RTMPS_ENCRYPTION_MODE` | No | omitted | Optional MediaMTX RTMPS encryption mode. Valid values are `no`, `optional`, and `strict`; when omitted, runtime defaults to `no`. |
| `RTMPS_CERT_PATH` | No | `/certs/server.crt` when RTMPS is configured | MediaMTX RTMPS server certificate path inside the container. |
| `RTMPS_KEY_PATH` | No | `/certs/server.key` when RTMPS is configured | MediaMTX RTMPS private key path inside the container. |

Redis and the MediaMTX control API are fixed internal Compose endpoints: `redis://redis:6379` and `http://mediamtx:9997`.

## Commands for run

`./scripts/run.sh` is the supported stack entrypoint for the Docker Compose runtime.

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

- `up`: Checks prerequisites, prepares storage, builds images, starts the full stack, and waits until the main services are ready.
- `down`: Stops and removes the Compose stack.
- `doctor`: Checks Docker, Docker Compose, `config.json`, and `.env`, then prints the fixed runtime ports and target-directory state.
- `ps`: Shows the current status of Compose services.
- `logs [service]`: Follows logs for the full stack or for a specific service.
- `reset`: Removes containers, volumes, all data under `TARGET_DIRECTORY`, and the persisted target-directory state. This is destructive and intended only for disposable development/test environments.
- `install-docker`: Runs the Ubuntu helper script to install Docker and Docker Compose.
