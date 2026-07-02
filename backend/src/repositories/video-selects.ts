import type { Prisma } from "@prisma/client";

export const repositoryVideoSelect = {
  id: true,
  repositoryId: true,
  recordingSessionId: true,
  status: true,
  durationSec: true,
  resolutionWidth: true,
  resolutionHeight: true,
  fps: true,
  codec: true,
  recordedAt: true,
  thumbnailPath: true,
  dashboardVideoPath: true,
  sizeBytes: true,
  recorder: true,
  semanticMetadata: {
    select: {
      videoId: true,
      status: true,
      clipSegments: true,
      actionLabels: true,
      videoTextAlignment: true,
      sceneSummary: true,
      errorMessage: true,
      processingStartedAt: true,
      processingCompletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  createdAt: true,
} satisfies Prisma.VideosSelect;

export const repositoryVideoStatusSelect = {
  id: true,
  repositoryId: true,
  recordingSessionId: true,
  status: true,
  errorMessage: true,
  processingStartedAt: true,
  processingCompletedAt: true,
} satisfies Prisma.VideosSelect;

export const managedRepositoryVideoSelect = {
  id: true,
  repositoryId: true,
  status: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
  sizeBytes: true,
  vlmSha256: true,
} satisfies Prisma.VideosSelect;

export const manifestVideoSelect = {
  id: true,
  durationSec: true,
  resolutionWidth: true,
  resolutionHeight: true,
  fps: true,
  codec: true,
  recordedAt: true,
  semanticMetadata: {
    select: {
      sceneSummary: true,
      clipSegments: true,
    },
  },
  sizeBytes: true,
  vlmSha256: true,
  thumbnailPath: true,
} satisfies Prisma.VideosSelect;

export const repositoryVideoPathSelect = {
  id: true,
  rawRecordingPath: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
} satisfies Prisma.VideosSelect;

export const repositoryRenameVideoPathSelect = {
  id: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
} satisfies Prisma.VideosSelect;

export const repositoryContributorVideoSelect = {
  recorder: true,
  recordedAt: true,
  createdAt: true,
} satisfies Prisma.VideosSelect;

export type RepositoryVideoRecord = Prisma.VideosGetPayload<{
  select: typeof repositoryVideoSelect;
}>;

export type RepositoryVideoStatusRecord = Prisma.VideosGetPayload<{
  select: typeof repositoryVideoStatusSelect;
}>;

export type ManagedRepositoryVideoRecord = Prisma.VideosGetPayload<{
  select: typeof managedRepositoryVideoSelect;
}>;

export type ManifestVideoRecord = Prisma.VideosGetPayload<{
  select: typeof manifestVideoSelect;
}>;

export type RepositoryVideoPathRow = Prisma.VideosGetPayload<{
  select: typeof repositoryVideoPathSelect;
}>;

export type RepositoryRenameVideoPathRow = Prisma.VideosGetPayload<{
  select: typeof repositoryRenameVideoPathSelect;
}>;

export type RepositoryContributorVideoRecord = Prisma.VideosGetPayload<{
  select: typeof repositoryContributorVideoSelect;
}>;
