# Configuration

`ego-flow-server` uses two root-level runtime configuration files:

- `config.json` for non-secret server settings
- `.env` for secrets and database bootstrap values

Create both with:

```bash
./scripts/setup-server-config.sh
```

The setup script is interactive and overwrites existing files after all prompts
complete.

## config.json

Example:

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
| `TARGET_DIRECTORY` | Yes | `~/ego-flow/ego-flow-data` | Host data root for Postgres, Redis, raw recordings, and generated datasets. Must be absolute or use `~/...`. |
| `CORS_ORIGIN` | No | `http://{detected_server_ip}` | Browser origin allowed to call the dashboard/API with credentials. Use `*` only intentionally. |
| `WORKER_CONCURRENCY` | No | `2` | Number of recording-finalize jobs that can run at once. |
| `DELETE_RAW_AFTER_PROCESSING` | No | `true` | Whether raw recordings are deleted after successful processing. |
| `JWT_EXPIRES_IN` | No | `24h` | App access-token lifetime. |
| `JWT_REFRESH_THRESHOLD_SECONDS` | No | `21600` | Remaining-token threshold for returning `X-Refreshed-Token`. |
| `SIGNED_FILE_URL_EXPIRES_IN` | No | `6h` | Lifetime of signed `/files/*` URLs for processed video and thumbnail access. |

## .env

Example:

```dotenv
ADMIN_DEFAULT_PASSWORD=changeme123
JWT_SECRET=replace-this-in-production

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
| `ADMIN_DEFAULT_PASSWORD` | Yes | `changeme123` | Initial password for the seeded `admin` dashboard account. Change it after first login. |
| `JWT_SECRET` | Yes | generated random secret | Secret used for app JWTs and signed file URLs. Must be at least 16 characters. |
| `POSTGRES_USER` | Yes | `postgres` | PostgreSQL username used by Compose. |
| `POSTGRES_PASSWORD` | Yes | `postgres` | PostgreSQL password used by Compose. |
| `POSTGRES_DB` | Yes | `egoflow` | PostgreSQL database name used by Compose. |
| `HF_TOKEN` | No | omitted | Optional Hugging Face token for integrations that need it. |
| `RTMPS_ENCRYPTION_MODE` | No | omitted | Optional RTMPS mode. Valid values are `no`, `optional`, and `strict`; omitted uses MediaMTX default `no`. |
| `RTMPS_CERT_PATH` | No | `/certs/server.crt` when RTMPS is configured | Certificate path inside the MediaMTX container. |
| `RTMPS_KEY_PATH` | No | `/certs/server.key` when RTMPS is configured | Private-key path inside the MediaMTX container. |

## CORS

The dashboard is normally served from the same host through Caddy, so the setup
default is usually enough. If you serve a separate dashboard origin, set
`CORS_ORIGIN` to that exact origin and restart the stack.

## RTMPS

RTMP is enabled by default on port `1935`. RTMPS is only useful when you provide
certificate and key files under `./certs` and configure MediaMTX to use them.
Set `RTMPS_ENCRYPTION_MODE=strict` only after the certificate paths are valid.

## After Changes

After editing `.env`, `config.json`, `Caddyfile`, `mediamtx.yml`, `mediamtx-hooks`,
or `certs`, restart with:

```bash
./scripts/run.sh up
```

The run script starts the Compose stack and restarts bind-mounted proxy or
MediaMTX services when their tracked configuration changed.
