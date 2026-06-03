export type RecordingSessionIngestTypeValue = "MEDIAMTX" | "HTTP";

export interface RecordingSessionLiveCache {
  repositoryId: string;
  repositoryName: string;
  userId: string;
  ingestType: RecordingSessionIngestTypeValue;
  deviceType?: string;
  status: "PENDING" | "STREAMING";
  rawPath?: string;
  bytesReceived?: number;
  lastSequence?: number | null;
  lastChunkAt?: number;
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
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  ingestType: RecordingSessionIngestTypeValue;
  streamPath: string;
  status: "active" | "consumed";
}

export interface HlsPlaybackTicketRecord {
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  ingestType: "MEDIAMTX";
  streamPath: string;
  status: "active" | "revoked";
}
