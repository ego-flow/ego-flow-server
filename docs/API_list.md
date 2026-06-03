# API List

Current API list based on the server codebase.

## System

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `GET /api/v1/health` | none | `{ status: "ok" }` | Server health check |
| `GET /api/v1/info` | none | `api_version`, `server_version`, `capabilities`, `urls` | Expose server capabilities and base URLs |
| `GET /api/v1/openapi.json` | none | OpenAPI JSON | Raw API spec |
| `GET /api-docs` | none | Swagger UI | Browser API docs |
| `GET /files/{owner}/{repo}/{file}?signature=...` | signed URL query | static file | Signed access to thumbnails and video artifacts |

## Auth / User

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/auth/app/login` | `{ id, password }` | `{ token, user }` | App JWT login |
| `POST /api/v1/auth/dashboard/login` | `{ id, password, remember_me? }` | `{ user }` plus session cookie | Dashboard cookie login |
| `POST /api/v1/auth/dashboard/logout` | dashboard cookie | `{ logged_out: true }` | Revoke dashboard session |
| `GET /api/v1/auth/dashboard/session` | dashboard cookie | `{ user: { id, role, display_name } }` | Read current dashboard session |
| `PUT /api/v1/auth/dashboard/me/password` | `{ currentPassword, newPassword }` | `{ message }` | Change current dashboard user's password |
| `POST /api/v1/auth/python/tokens` | dashboard cookie, `{ name }` | `{ id, name, token, created_at, rotated_previous }` | Issue or rotate Python static token |
| `GET /api/v1/auth/python/tokens` | dashboard cookie | `{ token }` | Read current user's active Python token metadata |
| `GET /api/v1/auth/python/tokens/validate` | Python bearer token | `{ valid: true, user: { id, role, display_name } }` | Validate current Python static token |
| `DELETE /api/v1/auth/python/tokens/:tokenId` | `tokenId` | `{ id, revoked: true }` | Revoke Python API token |
| `POST /api/v1/auth/mediamtx` | MediaMTX payload: `action`, `path`, `query`, `protocol?`, `token?` | `200` or `401`, empty body | MediaMTX publish and HLS playback auth callback |

## Admin

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/admin/users` | `{ id, password, displayName? }` | `{ user }` | Create user |
| `GET /api/v1/admin/users` | none | `{ users }` | List users |
| `DELETE /api/v1/admin/users/:userId/deactivate` | `userId` | `{ id, deactivated: true }` | Deactivate user |
| `GET /api/v1/admin/users/:userId/delete-readiness` | `userId` | `{ user_id, can_delete, checks }` | Check whether a user can be permanently deleted |
| `DELETE /api/v1/admin/users/:userId` | `userId` | `{ id, deleted: true }` | Permanently delete user |
| `PUT /api/v1/admin/users/:userId/password` | `{ newPassword }` | `{ id, passwordReset: true }` | Reset user password from admin client |
| `GET /api/v1/admin/python/tokens` | none | `{ tokens }` | List active Python tokens for admin management |
| `GET /api/v1/admin/settings` | none | `{ settings }` | Read runtime/config/env settings |

## Repositories

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/repositories` | `{ name, visibility?, description? }` | `{ repository }` | Create repository |
| `GET /api/v1/repositories` | none | `{ repositories }` | List accessible repositories |
| `GET /api/v1/repositories/maintain` | none | `{ repositories }` | List repositories the current user can maintain |
| `GET /api/v1/repositories/resolve?slug=owner/name` | `slug` or `owner_id` plus `name` | `{ repository }` | Resolve repository by owner/name |
| `GET /api/v1/repositories/:repoId` | `repoId` | `{ repository }` | Read repository detail |
| `PATCH /api/v1/repositories/:repoId` | `{ name?, visibility?, description? }` | `{ repository }` | Update repository settings |
| `DELETE /api/v1/repositories/:repoId/deactivate` | `repoId` | `{ id, deactivated: true }` | Deactivate repository before permanent deletion |
| `GET /api/v1/repositories/:repoId/delete-readiness` | `repoId` | `{ repository_id, can_delete, checks }` | Check whether a repository can be permanently deleted |
| `DELETE /api/v1/repositories/:repoId` | `repoId` | `{ id, deleted: true }` | Permanently delete a deactivated repository |
| `GET /api/v1/repositories/:repoId/members` | `repoId` | `{ repository, members }` | List repository members |
| `POST /api/v1/repositories/:repoId/members` | `{ user_id, role }` | `{ repository, members }` | Add or update repository member |
| `PATCH /api/v1/repositories/:repoId/members/:userId` | `{ role }` | `{ repository, members }` | Update repository member role |
| `DELETE /api/v1/repositories/:repoId/members/:userId` | path params | `{ repository_id, user_id, deleted: true }` | Remove repository member |

## Videos / Dataset

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `GET /api/v1/repositories/:repoId/videos` | `page`, `limit`, `status?`, `sort_by`, `sort_order`, `contributor_user_id?` | `{ total, page, limit, contributors, data }` | List/filter repository videos |
| `GET /api/v1/repositories/:repoId/videos/:videoId` | path params | video metadata plus `dashboard_video_url` | Read video detail |
| `GET /api/v1/repositories/:repoId/videos/:videoId/status` | path params | `{ id, repository_id, status, progress, error_message, processing_* }` | Read video processing status |
| `DELETE /api/v1/repositories/:repoId/videos/:videoId` | path params | `{ id, deleted: true }` | Delete video and generated artifacts |
| `GET /api/v1/repositories/:repoId/videos/:videoId/download` | path params | `307` signed file URL redirect | Download VLM video artifact |
| `GET /api/v1/repositories/:repoId/manifest?page&limit` | Python token | dataset manifest | Completed video manifest for Python/VLM usage |

## Live / Playback

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `GET /api/v1/live-streams` | auth | `{ streams }` | List Redis active sessions. `MEDIAMTX` sessions can play HLS; `HTTP` sessions are listed only |
| `GET /api/v1/live-streams/:recordingSessionId` | `recordingSessionId` | live stream detail plus `playback_ready` | Read one live session detail |
| `POST /api/v1/live-streams/:recordingSessionId/playback-ticket` | dashboard cookie or Python token | `{ playback_ticket, playback_ticket_expires_at }` | Issue short TTL HLS playback ticket |

## Streaming

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/streams/register` | `{ repositoryId, deviceType?, ingestType }` | `{ recordingSessionId }` | Register streaming session. `ingestType` is `MEDIAMTX` or `HTTP` |
| `POST /api/v1/streams/:recordingSessionId/publish-ticket` | path param | `{ stream_path, publish_ticket }` | Issue short TTL publish auth ticket |
| `POST /api/v1/recordings/:recordingSessionId/close-intent` | `{ reason: "NORMAL_DISCONNECT" }` | `{ ok: true }` | Record normal RTMP close intent before socket close |

## HTTP Ingest

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/http-streams/:recordingSessionId/start` | `{ publish_ticket }` | `{ recording_session_id, status, bytes_received, last_sequence }` | Start HTTP upload; session becomes `STREAMING`, segment becomes `WRITING` |
| `POST /api/v1/http-streams/:recordingSessionId/chunks` | raw `application/octet-stream`; headers `x-chunk-sequence`, `x-chunk-offset` | `{ recording_session_id, bytes_received, last_sequence }` | Append one chunk. Hot path validation uses Redis |
| `POST /api/v1/http-streams/:recordingSessionId/finish` | `{ total_bytes }` | `{ recording_session_id, status, segment_status, bytes_received }` | Validate total bytes, close session, mark segment `WRITE_DONE`, enqueue finalize |

## MediaMTX Hooks

| Endpoint | Input | Response | Purpose |
|---|---|---|---|
| `POST /api/v1/hooks/stream-ready` | `{ path, ticket }` | `{ ok: true }` | MediaMTX stream ready hook; consume ticket and mark session `STREAMING` |
| `POST /api/v1/hooks/stream-not-ready` | `{ path }` | `{ ok: true }` | MediaMTX publisher connection closed hook; mark session `CLOSED` |
| `POST /api/v1/hooks/recording-segment-create` | `{ path, segment_path }` | `{ ok: true }` | Create/upsert `RecordingSegment` as `WRITING` |
| `POST /api/v1/hooks/recording-segment-complete` | `{ path, segment_path }` | `{ ok: true }` | Mark segment `WRITE_DONE` and try finalize enqueue |
