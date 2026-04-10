export interface RecordingSessionLiveCache {
  recordingSessionId: string;
  repositoryId: string;
  repositoryName: string;
  ownerId: string;
  userId: string;
  deviceType?: string;
  targetDirectory: string;
  status: "PENDING" | "STREAMING" | "STOP_REQUESTED" | "FINALIZING";
  sourceId?: string;
  sourceType?: string;
  publishTicketIssuedAt?: string;
  readyAt?: string;
  stopRequestedAt?: string;
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
  streamId: string;
  recordingSessionId: string;
  connectionId: string;
  generation: number;
  repositoryId: string;
  repositoryName: string;
  userId: string;
  streamPath: string;
  issuedAt: number;
  expiresAt: number;
  status: "active" | "consumed" | "revoked";
}

export type StreamPublishOwnershipStatus = "claimed" | "publishing";

export interface StreamOwnerLease {
  streamId: string;
  recordingSessionId: string;
  connectionId: string;
  generation: number;
  status: StreamPublishOwnershipStatus;
  repositoryId: string;
  repositoryName: string;
  userId: string;
  streamPath: string;
  sourceId?: string;
  sourceType?: string;
  lastHeartbeatAt: number;
  leaseExpiresAt: number;
}

export interface StreamConnectionMetadata {
  streamId: string;
  recordingSessionId: string;
  connectionId: string;
  generation: number;
  repositoryId: string;
  repositoryName: string;
  userId: string;
  streamPath: string;
  status: StreamPublishOwnershipStatus;
  createdAt: number;
  sourceId?: string;
  sourceType?: string;
  lastHeartbeatAt: number;
  leaseExpiresAt: number;
}

export interface StreamSourceMapping {
  recordingSessionId: string;
  repositoryId: string;
  connectionId: string;
  generation: number;
  sourceId: string;
  sourceType: string;
}

export interface SegmentOwnershipMapping {
  recordingSessionId: string;
  repositoryId: string;
  connectionId: string;
  generation: number;
  sourceId?: string;
  segmentPath: string;
}
