# Streaming And Playback

EgoFlow Server supports three ingest paths and one live playback path:

- RTMP ingest through MediaMTX,
- WHIP/WebRTC ingest through MediaMTX behind Caddy,
- HTTP chunk upload ingest through the backend,
- HLS playback directly from MediaMTX.

This page gives the public operational overview. Detailed sequence diagrams live
under [../.mermaid](../.mermaid).

## Common Control Plane

All ingest paths start with the backend:

1. The app logs in and receives an app JWT.
2. The app registers a recording session for a repository.
3. The app requests a short-lived publish ticket.
4. The app starts the selected ingest transport.

The publish ticket is bound to a recording session, repository, ingest type, and
stream path. The default publish-ticket TTL is 60 seconds.

## RTMP

RTMP publishers connect to:

```text
rtmp://{server_host}:1935/live/{repo}/{recordingSessionId}?ticket={publish_ticket}
```

MediaMTX calls the backend auth endpoint before accepting the publisher. When
the stream becomes ready, MediaMTX hooks notify the backend so the recording
session can move to `STREAMING` and appear in live-stream listings.

Diagrams:

- [../.mermaid/RTMP/1.register.mmd](../.mermaid/RTMP/1.register.mmd)
- [../.mermaid/RTMP/2.publish-ticket.mmd](../.mermaid/RTMP/2.publish-ticket.mmd)
- [../.mermaid/RTMP/3.rtmp-publish.mmd](../.mermaid/RTMP/3.rtmp-publish.mmd)
- [../.mermaid/RTMP/4.rtmp-stream.mmd](../.mermaid/RTMP/4.rtmp-stream.mmd)
- [../.mermaid/RTMP/rtmp-connection-closure.mmd](../.mermaid/RTMP/rtmp-connection-closure.mmd)

## WHIP / WebRTC

WHIP signaling is exposed through Caddy on the public HTTP entrypoint:

```text
http://{server_host}:80/live/{repo}/{recordingSessionId}/whip?ticket={publish_ticket}
```

Media transport uses the WebRTC ICE UDP port `8189`. The MediaMTX WHIP service
itself remains internal behind Caddy.

Diagrams:

- [../.mermaid/WEBRTC/1.register.mmd](../.mermaid/WEBRTC/1.register.mmd)
- [../.mermaid/WEBRTC/2.publish-ticket.mmd](../.mermaid/WEBRTC/2.publish-ticket.mmd)
- [../.mermaid/WEBRTC/3.whip-publish.mmd](../.mermaid/WEBRTC/3.whip-publish.mmd)
- [../.mermaid/WEBRTC/4.whip-stream.mmd](../.mermaid/WEBRTC/4.whip-stream.mmd)
- [../.mermaid/WEBRTC/whip-connection-closure.mmd](../.mermaid/WEBRTC/whip-connection-closure.mmd)

## HTTP Chunk Upload

HTTP upload uses the same registration and publish-ticket pattern, but the app
sends media chunks to backend endpoints instead of publishing through MediaMTX.
The backend writes the raw file, tracks upload progress in Redis, and finalizes
the recording after the upload finishes.

HTTP uploads have a 30-second idle timeout measured from the last accepted
chunk, including the gap between start and the first chunk. The reconcile loop
runs every 30 seconds, so cleanup happens on the next loop after the timeout
condition is met. If chunks stop arriving, the loop closes the recording and
marks the resulting segment according to the recovered file state.

Diagrams:

- [../.mermaid/HTTP/http-streaming.mmd](../.mermaid/HTTP/http-streaming.mmd)
- [../.mermaid/HTTP/1.register.mmd](../.mermaid/HTTP/1.register.mmd)
- [../.mermaid/HTTP/3.http-start.mmd](../.mermaid/HTTP/3.http-start.mmd)
- [../.mermaid/HTTP/4.http-stream.mmd](../.mermaid/HTTP/4.http-stream.mmd)

## HLS Playback

Dashboard and Python clients list accessible live streams through the backend,
request a playback ticket for a selected recording session, then read HLS bytes
directly from MediaMTX:

```text
http://{server_host}:8888/live/{repo}/{recordingSessionId}/index.m3u8?ticket={playback_ticket}
```

The playback ticket is separate from the publish ticket. It is scoped to the
recording session and stream path, and its TTL is refreshed while MediaMTX auth
continues to validate it.

Diagrams:

- [../.mermaid/PLAYBACK/hls-playback.mmd](../.mermaid/PLAYBACK/hls-playback.mmd)
- [../.mermaid/PLAYBACK/dashboard-hls-playback.mmd](../.mermaid/PLAYBACK/dashboard-hls-playback.mmd)
- [../.mermaid/PLAYBACK/python-hls-playback.mmd](../.mermaid/PLAYBACK/python-hls-playback.mmd)

## Processing

After a recording segment is complete, the worker creates dashboard playback
media, dataset media, thumbnails, and metadata. Detailed processing diagrams are
available per ingest path:

- [../.mermaid/RTMP/5.video-processing.mmd](../.mermaid/RTMP/5.video-processing.mmd)
- [../.mermaid/WEBRTC/5.video-processing.mmd](../.mermaid/WEBRTC/5.video-processing.mmd)
- [../.mermaid/HTTP/5.video-processing.mmd](../.mermaid/HTTP/5.video-processing.mmd)

The high-level streaming overview is
[../.mermaid/STREAMING/streaming.mmd](../.mermaid/STREAMING/streaming.mmd), and
the recording state machine is
[../.mermaid/STREAMING/stream-state-machine.mmd](../.mermaid/STREAMING/stream-state-machine.mmd).
