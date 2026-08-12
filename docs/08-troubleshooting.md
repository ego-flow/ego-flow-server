# Troubleshooting

Start with:

```bash
./scripts/run.sh doctor
./scripts/run.sh ps
./scripts/run.sh logs
```

Use a service name to narrow logs:

```bash
./scripts/run.sh logs backend
./scripts/run.sh logs worker
./scripts/run.sh logs mediamtx
./scripts/run.sh logs proxy
```

## Missing Docker Or Compose

Symptom:

```text
Missing required command: docker
Docker Compose plugin is missing or not available.
```

Fix:

```bash
./scripts/run.sh install-docker
```

On Linux, make sure Docker is running and your user can access it. Restart the
terminal session after changing Docker group membership.

## Missing Configuration

Symptom:

```text
Missing config file: .../config.json
Missing env file: .../.env
```

Fix:

```bash
./scripts/setup-server-config.sh
./scripts/run.sh doctor
```

## Port Conflict

The stack binds fixed host ports: `80`, `1935`, `1936`, `8888`, and UDP `8189`.
If startup fails because a port is already in use, stop the conflicting service
or move it before running `up` again.

Useful checks:

```bash
ss -tulpen
docker ps
```

## Health Check Failure

If `up` waits and then reports that a service did not become healthy:

```bash
./scripts/run.sh ps
./scripts/run.sh logs backend
./scripts/run.sh logs dashboard
./scripts/run.sh logs proxy
```

Backend health depends on Postgres and Redis. Dashboard and proxy health depend
on backend readiness.

Quick HTTP checks:

```bash
curl http://127.0.0.1/api/v1/health
curl -I http://127.0.0.1/api-docs/
```

Use `/api-docs/` with a trailing slash when checking for a direct `200` status.

## Publish Fails

Check app-side URL construction first. RTMP publish URLs must include the stream
path and short-lived publish ticket:

```text
rtmp://{server_host}:1935/live/{repo}/{recordingSessionId}?ticket={publish_ticket}
```

Then inspect:

```bash
./scripts/run.sh logs backend
./scripts/run.sh logs mediamtx
```

Look for:

- `[publish-auth] allowed`
- `[publish-auth] denied`
- `stream-ready`
- `stream-not-ready`

Common causes include expired publish tickets, stream path mismatch, wrong
ingest type, repository permission failure, or the app using a stale URL.

## HLS Playback Fails

HLS playback is direct to MediaMTX:

```text
http://{server_host}:8888/live/{repo}/{recordingSessionId}/index.m3u8?ticket={playback_ticket}
```

Check:

```bash
./scripts/run.sh logs backend
./scripts/run.sh logs mediamtx
```

Look for:

- `[hls-auth] allowed`
- `[hls-auth] denied`
- `[streams.active] generated playback URLs`

Common causes include expired playback tickets, missing live cache, inactive
stream path, or firewall rules blocking port `8888`.

## HTTP Upload Stalls

HTTP upload sessions become timeout candidates after 30 seconds without an
accepted chunk. The reconcile loop runs every 30 seconds, so cleanup happens on
the next loop. Inspect backend and worker logs:

```bash
./scripts/run.sh logs backend
./scripts/run.sh logs worker
```

Look for `[http-stream]` and worker processing messages. If the backend closes an
idle upload, it may recover the raw file when size and offset checks match, or
mark the segment/video failed when the raw file is missing or inconsistent.

## Storage Permission Problems

`TARGET_DIRECTORY` must be writable by Docker containers. If Postgres, Redis,
backend, or worker logs show permission errors, confirm the data root path and
directory ownership.

Use a dedicated data root. Do not point `TARGET_DIRECTORY` at a repository
checkout or shared home directory.

## Resetting A Disposable Environment

Only for environments where data loss is acceptable:

```bash
./scripts/run.sh reset
./scripts/run.sh up
```

`reset` removes containers, volumes, data under `TARGET_DIRECTORY`, and persisted
target-directory state.
