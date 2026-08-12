# Runtime Operations

`./scripts/run.sh` is the supported entrypoint for local and remote Docker
Compose operation.

## Commands

```bash
./scripts/run.sh doctor
./scripts/run.sh up
./scripts/run.sh ps
./scripts/run.sh logs [service]
./scripts/run.sh down
./scripts/run.sh reset
./scripts/run.sh install-docker
```

| Command | Purpose |
| --- | --- |
| `doctor` | Check Docker, Docker Compose, `config.json`, `.env`, fixed ports, and target-directory state. |
| `up` | Check prerequisites, prepare storage, migrate target data when needed, build images, start services, and wait for readiness. |
| `ps` | Show Compose service status. |
| `logs [service]` | Follow logs for all services or a single service such as `backend`, `worker`, `mediamtx`, or `proxy`. |
| `down` | Stop and remove the Compose stack. Persistent bind-mounted data remains under `TARGET_DIRECTORY`. |
| `reset` | Destructively remove containers, volumes, target-directory data, and persisted run state. Use only for disposable environments. |
| `install-docker` | Run the Ubuntu Docker installation helper. |

## Services

The runtime starts these Compose services:

```text
postgres redis backend worker dashboard proxy mediamtx
```

`up` waits for `postgres`, `redis`, `backend`, `dashboard`, and `proxy` to become
healthy, then waits for `worker` and `mediamtx` to be running.

## Ports

| Port | Exposure | Purpose |
| --- | --- | --- |
| `80/tcp` | Host | Public HTTP entrypoint for dashboard, backend API, Swagger UI, signed files, and WHIP signaling. |
| `1935/tcp` | Host | RTMP ingest. |
| `1936/tcp` | Host | Optional RTMPS ingest. |
| `8189/udp` | Host | WebRTC ICE media used by WHIP. |
| `8888/tcp` | Host | Direct MediaMTX HLS playback. |
| `3000/tcp` | Compose internal | Backend API service. |
| `8088/tcp` | Compose internal | Dashboard service. |
| `8889/tcp` | Compose internal | MediaMTX WHIP signaling behind Caddy. |
| `9997/tcp` | Compose internal | MediaMTX API used by the backend. |

## Public HTTP Routes

Caddy listens on port `80` and routes:

- `/api*`, `/api-docs*`, and `/files*` to the backend,
- `/live/{repo}/{recordingSessionId}/whip` to MediaMTX WHIP signaling,
- all other paths to the dashboard.

HLS playback does not go through Caddy. Clients read directly from MediaMTX on
port `8888` with a playback ticket.

## Health And Logs

Common checks:

```bash
./scripts/run.sh ps
./scripts/run.sh logs backend
./scripts/run.sh logs worker
./scripts/run.sh logs mediamtx
curl http://127.0.0.1/api/v1/health
```

Useful backend log markers:

- `[startup] runtime playback config`
- `[streams.active] generated playback URLs`
- `[publish-auth] allowed` or `[publish-auth] denied`
- `[hls-auth] allowed` or `[hls-auth] denied`
- `[http-stream] ...`
- `[rtmp-reconcile] ...`

## Updating A Checkout

For a release deployment, fetch tags and switch explicitly to the desired
release. For the current release:

```bash
git fetch --tags origin
git switch --detach v0.0.1
./scripts/run.sh up
```

At a future release, replace `v0.0.1` with the new release tag. For a development
checkout that follows `main`:

```bash
git switch main
git pull --ff-only
./scripts/run.sh up
```

`up` rebuilds images and restarts services as needed. It also tracks hashes for
`Caddyfile`, `mediamtx.yml`, `mediamtx-hooks`, and `certs`, then restarts the
affected service when those bind-mounted configs changed.

## Reset

`reset` is destructive:

```bash
./scripts/run.sh reset
```

It removes containers, Compose volumes, data under `TARGET_DIRECTORY`, and the
persisted `.run/target-directory` state. Do not use it on a real deployment
unless losing all local server data is intended.
