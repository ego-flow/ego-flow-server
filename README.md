# EgoFlow Server

EgoFlow is a platform for collecting egocentric video from AR glasses (such as Ray-Ban Meta, Google Glass, and Samsung smart glasses). It supports both video capture and live streaming, and includes a web dashboard for managing recordings. You can also use our Python library to work with the collected data in your own projects.

This repository contains the EgoFlow server stack that powers the app, Python library, and web dashboard.

The EgoFlow app is available on the App Store.

| Android | IOS |
| :--------------------------------: | :--------------------------------: |
| App Store | [EgoFlow App](https://example.com) |


The EgoFlow Python package is available via:
```bash
pip install ego-flow
```

## Getting Started

### Prerequisites

- Docker Engine or Docker Desktop with Docker Compose v2.
- Node.js `24+` only if you want to run `npm` directly in `backend/` or `frontend/`. It is not required for the default Docker workflow.

Verify your environment:

```bash
./scripts/run.sh doctor
```

### Configuration

Create `config.json` and `.env` before starting the server.

The quickest local setup is:

```bash
cp ./config.json.example ./config.json
cp ./.env.example ./.env
```

Then update the values for your environment.

Configuration examples and field-by-field explanations are documented in [Configuration Details](#configuration-details).

### Start the Server

```bash
./scripts/run.sh up
```

When startup finishes, HTTP access goes through a single public entrypoint:

- `http://localhost` when `PUBLIC_HTTP_PORT` is `80`
- `http://localhost:{PUBLIC_HTTP_PORT}` when you changed the public HTTP port

Using that HTTP base URL, the current local stack exposes:

- Backend health: `{PUBLIC_HTTP_BASE}/api/v1/health`
- Swagger UI: `{PUBLIC_HTTP_BASE}/api-docs`
- OpenAPI JSON: `{PUBLIC_HTTP_BASE}/api/v1/openapi.json`
- Dashboard: `{PUBLIC_HTTP_BASE}`
- RTMP ingest: `rtmp://localhost:{RTMP_PORT}/live`
- HLS output: `http://localhost:{HLS_PORT}`

Current local seeded dashboard login:

- ID: `admin`
- Password: `changeme123`

### Published Ports

| Port | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_HTTP_PORT` | `80` | Public HTTP entrypoint for dashboard, API, Swagger UI, OpenAPI JSON, and `/files/*` |
| `RTMP_PORT` | `1935` | RTMP ingest |
| `HLS_PORT` | `8888` | HLS playback |
| `MEDIAMTX_API_PORT` | `9997` | Internal MediaMTX control API port used inside the Docker network |


## Storage and Target Directory

> *Warning: Files under `TARGET_DIRECTORY` that are not related to EgoFlow Server may be removed during server operations.*

`TARGET_DIRECTORY` is the root directory that EgoFlow Server manages for processed outputs. Use a dedicated directory for EgoFlow only. In the default Docker Compose setup, the container path `/data/datasets` is bind-mounted to `./data/datasets` on the host.

Raw ingest files are stored separately under `./data/raw` and are not part of `TARGET_DIRECTORY`.

Typical layout under `TARGET_DIRECTORY`:

```text
{TARGET_DIRECTORY}/
└── {owner_id}/
    └── {repository_name}/
        ├── {video_id}.mp4
        ├── .dashboard/
        │   └── {video_id}.mp4
        └── .thumbnails/
            └── {video_id}.jpg
```

- `{video_id}.mp4` is the processed dataset/VLM video.
- `.dashboard/` stores the dashboard playback copy.
- `.thumbnails/` stores generated preview images.
- Temporary processing files may be created under `{TARGET_DIRECTORY}/.tmp/` while recordings are being finalized.
- If `TARGET_DIRECTORY` changes, the backend migrates managed files to the new location on startup and rewrites stored paths. Treat this as an operations change with backup/rollback planning in production.

## Configuration Details

### config.json

Only `TARGET_DIRECTORY` is required and does not have a default. Everything else is optional and has sensible defaults.

*Warning: Files under `TARGET_DIRECTORY` may be removed during server operations.*

```json
{
  "TARGET_DIRECTORY": "/data/datasets",
  "PUBLIC_HTTP_PORT": 80,
  "RTMP_PORT": 1935,
  "HLS_PORT": 8888,
  "MEDIAMTX_API_PORT": 9997,
  "JWT_EXPIRES_IN": "24h",
  "JWT_REFRESH_THRESHOLD_SECONDS": 21600,
  "CORS_ORIGIN": "*",
  "WORKER_CONCURRENCY": 2,
  "DELETE_RAW_AFTER_PROCESSING": true
}
```

Here’s what each config field does.

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `TARGET_DIRECTORY` | Yes | None | Root directory for server-managed files, including processed media and other files required for server operations. |
| `PUBLIC_HTTP_PORT` | No | `80` | Public HTTP port exposed to users. The reverse proxy serves both the dashboard and backend routes behind this single entry point. |
| `RTMP_PORT` | No | `1935` | Port used for RTMP ingest from the app or AR glasses. |
| `HLS_PORT` | No | `8888` | Port used for HLS live playback output. |
| `MEDIAMTX_API_PORT` | No | `9997` | Internal port used for the MediaMTX control API. It is not published externally in the default stack. |
| `JWT_EXPIRES_IN` | No | `24h` | Access-token lifetime. |
| `JWT_REFRESH_THRESHOLD_SECONDS` | No | `21600` | Remaining-token threshold for issuing a refreshed token in responses. |
| `CORS_ORIGIN` | No | `*` | Allowed browser origin for dashboard/API requests. |
| `WORKER_CONCURRENCY` | No | `2` | Number of recording finalize jobs the worker can process in parallel. |
| `DELETE_RAW_AFTER_PROCESSING` | No | `true` | Whether raw recorded segments are deleted after successful post-processing. |

The reverse proxy listens on `PUBLIC_HTTP_PORT` and forwards `/api*`, `/api-docs*`, and `/files*` to the backend while sending all remaining web routes to the dashboard. backend `3000` and dashboard `8088` stay internal to the Docker network.

The shared proxy policy lives in `ego-flow-server/Caddyfile` and is used by both the local compose stack and the EC2 compose stack.


### .env

`.env` is required for startup because it holds the seeded admin password and JWT signing secret.

```bash
# Required
ADMIN_DEFAULT_PASSWORD=changeme123
JWT_SECRET=replace-this-in-production

# Optional overrides
# Defaults exist for the bundled Compose stack.
# Set these explicitly in production.
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/egoflow?schema=public
REDIS_URL=redis://redis:6379
HF_TOKEN=your-hf-token-for-hf-connection
PUBLIC_RTMP_BASE_URL=rtmp://your-host:1935/live
PUBLIC_HLS_BASE_URL=http://your-host:8888
MEDIAMTX_API_URL=http://mediamtx:9997
```

Here’s what each `.env` field does.

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `ADMIN_DEFAULT_PASSWORD` | Yes | None | Default password for the seeded admin account. |
| `JWT_SECRET` | Yes | None | Secret key used to sign and verify JWT access tokens. |
| `DATABASE_URL` | No | `postgresql://postgres:postgres@postgres:5432/egoflow?schema=public` | PostgreSQL connection string override. The bundled Compose stack works without setting it because this default is applied automatically. |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection string override. The bundled Compose stack works without setting it because this default is applied automatically. |
| `HF_TOKEN` | No | None | Hugging Face token used for Hugging Face integration. |
| `PUBLIC_RTMP_BASE_URL` | No | `rtmp://127.0.0.1:{RTMP_PORT}/live` | Public RTMP base URL returned to clients. Optional locally, but set it explicitly in non-local deployments. |
| `PUBLIC_HLS_BASE_URL` | No | `http://127.0.0.1:{HLS_PORT}` | Public HLS base URL returned to clients. Optional locally, but set it explicitly in non-local deployments. |
| `MEDIAMTX_API_URL` | No | `http://mediamtx:{MEDIAMTX_API_PORT}` | Internal MediaMTX API URL override used by the backend. |

## Commands for run

`./scripts/run.sh` is the only supported local entrypoint for managing the current Docker Compose stack.

The local stack is rendered from `compose.yml` and `compose.local.yml`.

```bash
  ./scripts/run.sh up               # Build and start the stack
  ./scripts/run.sh down             # Stop the stack
  ./scripts/run.sh doctor           # Check prerequisites
  ./scripts/run.sh ps               # Show service status
  ./scripts/run.sh logs [service]   # Follow logs
  ./scripts/run.sh reset            # Remove containers, volumes, and data
  ./scripts/run.sh install-docker   # Install Docker on Ubuntu
```

Command summary:

- `./scripts/run.sh up`: Checks prerequisites, builds images, starts the full stack, and waits until the main services are ready.
- `./scripts/run.sh down`: Stops and removes the Compose stack.
- `./scripts/run.sh doctor`: Checks Docker, Docker Compose, `config.json`, `.env`, and the configured public RTMP/HLS port values.
- `./scripts/run.sh ps`: Shows the current status of Compose services.
- `./scripts/run.sh logs [service]`: Follows logs for the full stack or for a specific service.
- `./scripts/run.sh reset`: Removes containers, volumes, and local bind-mount data under `./data/`. This is destructive.
- `./scripts/run.sh install-docker`: Runs the Ubuntu helper script to install Docker and Docker Compose.

`./scripts/run.sh reset` is a local-development helper. It is not a production deployment procedure.

Production data changes, schema migrations, backup/restore, and `TARGET_DIRECTORY` change procedures are documented in [deploy/ec2/data-operations.md](/home/dennis0405/ego-flow/deploy/ec2/data-operations.md).

## For Developers

If you want to customize or contribute to the project, please refer to the following documents:

- [Backend development docs](./backend/README.md)
- [Frontend development docs](./frontend/README.md)
- Android app development docs (coming soon)
- iOS app development docs (coming soon)
- Python package docs (coming soon)

## Project Status

This repository is currently in beta and remains under active development.

Planned and ongoing work:

- [ ] List major milestones or key objectives here.
