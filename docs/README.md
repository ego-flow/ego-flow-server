# EgoFlow Server Documentation

This directory contains the public operations documentation for `ego-flow-server`.
It is written for people who want to run, configure, and troubleshoot an
EgoFlow server deployment.

## Documents

| Document | Purpose |
| --- | --- |
| [01-overview.md](./01-overview.md) | High-level server role, runtime components, and data flow. |
| [02-installation.md](./02-installation.md) | Host prerequisites, repository setup, first configuration, and first boot. |
| [03-configuration.md](./03-configuration.md) | `config.json`, `.env`, target directory, CORS, secrets, and optional RTMPS settings. |
| [04-runtime-operations.md](./04-runtime-operations.md) | Supported `./scripts/run.sh` commands, service ports, readiness, logs, updates, and reset. |
| [05-storage-and-data.md](./05-storage-and-data.md) | Persistent data layout, generated files, migration behavior, backups, and cleanup cautions. |
| [06-streaming-and-playback.md](./06-streaming-and-playback.md) | RTMP, WHIP, HTTP upload, HLS playback, and links to detailed Mermaid flow diagrams. |
| [07-authentication-and-access-control.md](./07-authentication-and-access-control.md) | Dashboard sessions, app JWTs, Python tokens, repository roles, tickets, and signed files. |
| [08-troubleshooting.md](./08-troubleshooting.md) | Common Docker, configuration, port, health check, media, and storage issues. |

## Scope

These documents intentionally avoid duplicating generated API reference content.
After the server is running, use the built-in Swagger UI at `/api-docs` and the
OpenAPI JSON at `/api/v1/openapi.json` for endpoint-level details.

Detailed stream, playback, HTTP upload, Python package, and database diagrams
live under [../.mermaid](../.mermaid). The public docs link to those diagrams
instead of repeating every sequence step inline.

## Quick Path

1. Read [01-overview.md](./01-overview.md) to understand the server.
2. Follow [02-installation.md](./02-installation.md) and
   [03-configuration.md](./03-configuration.md) to create local configuration.
3. Use [04-runtime-operations.md](./04-runtime-operations.md) to start and
   operate the stack.
4. Check [08-troubleshooting.md](./08-troubleshooting.md) when a startup or
   runtime check fails.
