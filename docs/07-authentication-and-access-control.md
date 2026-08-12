# Authentication And Access Control

EgoFlow Server uses separate credential types for dashboard users, app clients,
Python clients, MediaMTX publish/read authorization, and signed file access.

## User Roles

System users have one of two roles:

| Role | Meaning |
| --- | --- |
| `admin` | Can manage users, inspect admin settings, and access repositories as an administrator. |
| `user` | Can use repositories according to repository membership and visibility. |

Inactive users cannot authenticate.

## Dashboard Sessions

Dashboard login uses an HttpOnly cookie-backed session. The session is created
after password authentication and stored server-side in Redis. Dashboard routes
use the session cookie instead of exposing the raw session token to browser
JavaScript.

Dashboard users can:

- browse accessible repositories,
- manage repositories where they have sufficient role,
- review processed videos,
- watch accessible live streams,
- issue and revoke their Python token,
- change their password.

System admins can also create users, reset passwords, deactivate users, and
inspect Python token metadata.

## App JWTs

The app logs in with user id and password and receives an access token. App JWTs
are used for capture and ingest control-plane calls, including recording-session
registration, publish-ticket issuance, HTTP chunk upload, and close-intent
requests.

When a valid app token is close to expiration, the backend can return
`X-Refreshed-Token`. Clients should use the refreshed token for subsequent app
requests.

## Python Tokens

Python clients use static tokens with the `ef_` prefix. A dashboard user issues
or revokes their token from the dashboard profile flow. Only a token hash is
stored by the server, and the raw token is returned only when issued.

Python tokens are used for dataset manifest access, artifact download redirects,
and Python live playback flows. Repository access checks still apply.

## Repository Roles

Repository permissions are role-based:

| Repository role | Typical access |
| --- | --- |
| `read` | View repository metadata, processed videos, manifests, downloads, and live playback where allowed. |
| `maintain` | Includes read access and can record streams or delete videos. |
| `admin` | Includes maintain access and can update repository settings, manage members, deactivate, and delete. |

Public repositories grant read-level fallback access. Private repositories
require membership unless the requester is a system admin.

Important policy points:

- stream recording requires `maintain`,
- video delete requires `maintain`,
- repository settings and membership management require repository `admin`,
- live playback requires `read`,
- repository permanent delete requires deactivation first.

## Publish Tickets

MediaMTX publish is not authorized by app JWT directly. The app first requests a
short-lived publish ticket from the backend. MediaMTX then sends publish auth
callbacks to the backend, and the backend validates the ticket against the
expected stream path and ingest type.

Legacy publish credentials such as static password or token fields are rejected
for publish. The current supported credential is the `ticket` query parameter in
the publish URL.

## Playback Tickets

Live HLS playback uses playback tickets, not publish tickets. A dashboard or
Python client asks the backend for a playback ticket for an accessible live
recording session. MediaMTX validates HLS read requests through backend auth
callbacks before serving playlist or segment bytes.

Playback tickets are scoped to the recording session and stream path. HLS bytes
are read directly from MediaMTX on port `8888`.

## Signed File Access

Processed videos and thumbnails are served through signed `/files/*` URLs. The
backend signs a storage-relative path with an expiration time. File serving then
verifies the signature and rejects missing, expired, mismatched, or malformed
signatures.

This means generated files are not exposed as ordinary static files. Dashboard
and Python clients first pass repository access checks, then receive signed URLs
or redirects for the specific file.
