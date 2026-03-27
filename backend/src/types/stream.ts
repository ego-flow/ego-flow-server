export interface StreamSessionCache {
  userId: string;
  repositoryId: string;
  repositoryName: string;
  ownerId: string;
  deviceType?: string;
  targetDirectory: string;
  registeredAt: string;
  sessionId: string;
  stoppedAt?: string;
}

export interface VideoProcessingJobData {
  videoId: string;
  repositoryId: string;
  ownerId: string;
  repoName: string;
  rawRecordingPath: string;
  targetDirectory: string;
}
