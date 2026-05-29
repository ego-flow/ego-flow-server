export const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
export const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
export const streamSourceKey = (sourceId: string) => `stream:source:${sourceId}`;
export const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;
export const streamSegmentKey = (segmentPath: string) => `segment:${segmentPath}`;

export const streamTicketKey = (ticketId: string) => `stream:ticket:${ticketId}`;
export const activeTicketKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}:ticket:active`;
export const streamOwnerKey = (streamId: string) => `stream:${streamId}:owner`;
export const streamOwnerGenerationKey = (streamId: string) => `stream:${streamId}:generation`;
export const streamConnectionKey = (connectionId: string) => `conn:${connectionId}`;
