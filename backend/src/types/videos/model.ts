import type { VideoStatus } from "@prisma/client";

export interface RepositoryVideoContext {
  id: string;
  name: string;
  ownerId: string;
}

export interface RepositoryContributorSummary {
  userId: string;
  displayName: string;
  videoCount: number;
  latestRecordedAt: Date | null;
}

export interface RepositoryVideoMapperInput {
  id: string;
  repositoryId: string;
  recordingSessionId: string | null;
  status: VideoStatus;
  durationSec: number | null;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  fps: number | null;
  codec: string | null;
  recordedAt: Date | null;
  thumbnailPath: string | null;
  dashboardVideoPath: string | null;
  sizeBytes: bigint | number | null;
  recorder: string | null;
  semanticMetadata: {
    sceneSummary: string | null;
    clipSegments: unknown;
  } | null;
  createdAt: Date;
}
