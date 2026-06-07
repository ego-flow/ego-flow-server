import type { RecordingSessionIngestTypeValue } from "./model";

export interface LiveStreamResponse {
  recording_session_id: string;
  repository_id: string;
  repository_name: string;
  user_id: string;
  device_type: string | null;
  ingest_type: RecordingSessionIngestTypeValue;
  stream_path: string;
  status: "live";
  playback_available: boolean;
}

export interface LiveStreamDetailResponse extends LiveStreamResponse {
  owner_id: string;
  registered_at: string;
  playback_ready: boolean;
  bytes_received: number | null;
  last_sequence: number | null;
  last_chunk_at: string | null;
}

export interface HlsPlaybackTicketResponse {
  playback_ticket: string;
}
