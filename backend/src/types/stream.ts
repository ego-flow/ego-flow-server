export interface StreamSessionCache {
  userId: string;
  videoKey: string;
  deviceType?: string;
  targetDirectory: string;
  registeredAt: string;
  sessionId: string;
  stoppedAt?: string;
}

export interface VideoProcessingJobData {
  videoId: string;
  videoKey: string;
  userId: string;
  rawRecordingPath: string;
  targetDirectory: string;
}
