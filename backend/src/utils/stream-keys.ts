export const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

export const streamTicketKey = (ticketId: string) => `stream:ticket:${ticketId}`;

export const hlsPlaybackTicketKey = (ticketId: string) => `stream:hls-ticket:${ticketId}`;

export const httpUploadLockKey = (recordingSessionId: string) => `stream:http-upload-lock:${recordingSessionId}`;
