export const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

export const streamSegmentKey = (segmentPath: string) => `segment:${segmentPath}`;

export const streamTicketKey = (ticketId: string) => `stream:ticket:${ticketId}`;
