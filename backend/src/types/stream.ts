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
