import {
  HLS_PLAYBACK_TICKET_KEY_PREFIX,
  HTTP_UPLOAD_LOCK_KEY_PREFIX,
  STREAM_RECORDING_KEY_PREFIX,
  STREAM_TICKET_KEY_PREFIX,
} from "../../constants/stream/stream-key-constants";

export const streamRecordingKey = (recordingSessionId: string) => `${STREAM_RECORDING_KEY_PREFIX}${recordingSessionId}`;

export const streamTicketKey = (ticketId: string) => `${STREAM_TICKET_KEY_PREFIX}${ticketId}`;

export const hlsPlaybackTicketKey = (ticketId: string) => `${HLS_PLAYBACK_TICKET_KEY_PREFIX}${ticketId}`;

export const httpUploadLockKey = (recordingSessionId: string) => `${HTTP_UPLOAD_LOCK_KEY_PREFIX}${recordingSessionId}`;
