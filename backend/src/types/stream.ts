export interface RecordingSessionLiveCache {
  recordingSessionId: string;
  repositoryId: string;
  repositoryName: string;
  userId: string;
  deviceType?: string;
  status: "PENDING" | "STREAMING" | "STOP_REQUESTED" | "FINALIZING";
  sourceId?: string;
}

export interface RecordingFinalizeJobData {
  recordingSessionId: string;
  videoId: string;
  repositoryId: string;
  ownerId: string;
  repoName: string;
  targetDirectory: string;
}

export interface PublishTicketRecord {
  ticketId: string;
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  streamPath: string;
  issuedAt: number;
  expiresAt: number;
  status: "active" | "consumed";
}

export interface StreamSourceMapping {
  recordingSessionId: string;
  repositoryId: string;
  sourceId: string;
  sourceType: string;
}

export interface SegmentOwnershipMapping {
  recordingSessionId: string;
  repositoryId: string;
  sourceId?: string;
  segmentPath: string;
}
