import type { RecordingSessionIngestTypeValue } from "./model";

export interface StreamRegisterResponse {
  recordingSessionId: string;
}

export interface StreamPublishTicketResponse {
  stream_path: string;
  publish_ticket: string;
}

export interface HttpStreamStartResponse {
  recording_session_id: string;
  status: "STREAMING";
  bytes_received: number;
  last_sequence: number | null;
}

export interface HttpStreamAppendChunkResponse {
  recording_session_id: string;
  bytes_received: number;
  last_sequence: number;
}

export interface HttpStreamFinishResponse {
  recording_session_id: string;
  status: "CLOSED";
  segment_status: "WRITE_DONE";
  bytes_received: number;
}

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
