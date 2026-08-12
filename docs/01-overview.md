# EgoFlow Server Overview

`ego-flow-server` is the self-hosted server component of the EgoFlow pipeline.
It receives streams or uploads from EgoFlow clients, records raw media, processes
recordings into dataset-ready files, stores metadata, serves the dashboard, and
exposes collected videos to dashboard and Python clients.

## Runtime Components

The production runtime is a Docker Compose stack:

| Component | Role |
| --- | --- |
| `proxy` | Caddy reverse proxy on host port `80`. Routes API, dashboard, Swagger UI, signed files, and WHIP signaling. |
| `dashboard` | Web UI for login, repository management, video review, live monitoring, user management, and Python token management. |
| `backend` | Express API server. Handles auth, repository access checks, stream registration, MediaMTX callbacks, file signing, and OpenAPI docs. |
| `worker` | Background worker for recording finalization, metadata probing, transcoding, thumbnail generation, and database updates. |
| `mediamtx` | Media server for RTMP ingest, WHIP/WebRTC ingest, HLS playback, and raw segment recording. |
| `postgres` | Persistent relational metadata store. |
| `redis` | Runtime cache for sessions, tickets, live stream state, and BullMQ worker queues. |

## Main Data Flow

The usual live capture path is:

```text
EgoFlow app
  -> backend stream registration and publish ticket
  -> MediaMTX publish path
  -> raw recording under TARGET_DIRECTORY/raw
  -> worker processing
  -> generated files under TARGET_DIRECTORY/datasets
  -> dashboard and Python clients
```

The server also supports HTTP chunk upload ingest. In that mode, the app still
uses the backend control plane, but media bytes are uploaded to the backend
instead of being published through MediaMTX.

## Public Entrypoints

The stack is designed around one public HTTP entrypoint:

```text
http://{server_host}:80
```

The same entrypoint serves the dashboard, backend API, Swagger UI, signed file
access, and WHIP signaling. RTMP, optional RTMPS, direct HLS playback, and WebRTC
ICE use fixed media ports documented in
[04-runtime-operations.md](./04-runtime-operations.md).

## Repository-Centered Model

Repositories are the main organizing unit. A repository controls:

- who can record new streams,
- who can view or download processed videos,
- where generated dataset files are stored,
- which live streams are visible to a user,
- which owner and repository name are used in generated dataset paths.

Repository roles are explained in
[07-authentication-and-access-control.md](./07-authentication-and-access-control.md).

## Where To Go Next

- Install and start the server: [02-installation.md](./02-installation.md)
- Configure secrets and storage: [03-configuration.md](./03-configuration.md)
- Operate the stack: [04-runtime-operations.md](./04-runtime-operations.md)
- Understand media flow: [06-streaming-and-playback.md](./06-streaming-and-playback.md)
