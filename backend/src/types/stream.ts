export interface RecordingSessionLiveCache {
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
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  streamPath: string;
  status: "active" | "consumed";
}
