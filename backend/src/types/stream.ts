export interface RecordingSessionLiveCache {
  recordingSessionId: string;
  repositoryId: string;
  repositoryName: string;
  userId: string;
  deviceType?: string;
  status: "PENDING" | "STREAMING";
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
  status: "active" | "consumed";
}
