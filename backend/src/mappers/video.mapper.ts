import { VideoStatus } from "@prisma/client";

import { toSignedFileUrl } from "../lib/storage/signed-file-url";
import type { RepositoryVideoRecord } from "../repositories/videos.repository";
import {
  RECORDING_FINALIZE_COMPLETED_PROGRESS,
  type RecordingFinalizeProgress,
} from "../types/processing";
import type {
  RepositoryContributorResponse,
  RepositoryContributorSummary,
  RepositoryVideoContext,
  RepositoryVideoResponse,
  RepositoryVideoStatusResponse,
} from "../types/videos";

const normalizeProgress = (
  status: VideoStatus,
  progress: RecordingFinalizeProgress | null,
): RecordingFinalizeProgress | null => {
  if (progress) {
    return progress;
  }

  return status === VideoStatus.COMPLETED ? RECORDING_FINALIZE_COMPLETED_PROGRESS : null;
};

const toRepositoryThumbnailUrl = (
  targetDirectory: string,
  video: Pick<RepositoryVideoRecord, "thumbnailPath">,
) => toSignedFileUrl(targetDirectory, video.thumbnailPath);

const toSizeBytes = (value: bigint | number | null | undefined) => {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return typeof value === "number" ? value : null;
};

export const toRepositoryVideoResponse = (
  targetDirectory: string,
  video: RepositoryVideoRecord,
  repository: RepositoryVideoContext,
  displayNamesByUserId: Map<string, string>,
  options?: { includeDashboardVideoUrl?: boolean; processingProgress?: RecordingFinalizeProgress | null },
): RepositoryVideoResponse => ({
  id: video.id,
  repository_id: repository.id,
  repository_name: repository.name,
  owner_id: repository.ownerId,
  status: video.status,
  duration_sec: video.durationSec,
  resolution_width: video.resolutionWidth,
  resolution_height: video.resolutionHeight,
  fps: video.fps,
  codec: video.codec,
  recorded_at: video.recordedAt ? video.recordedAt.toISOString() : null,
  size_bytes: toSizeBytes(video.sizeBytes),
  contributor_user_id: video.recorder,
  contributor_display_name: video.recorder ? displayNamesByUserId.get(video.recorder) ?? video.recorder : null,
  thumbnail_url: video.thumbnailPath ? toRepositoryThumbnailUrl(targetDirectory, video) : null,
  processing_progress:
    video.status === VideoStatus.PROCESSING ? normalizeProgress(video.status, options?.processingProgress ?? null) : null,
  ...(options?.includeDashboardVideoUrl
    ? { dashboard_video_url: toSignedFileUrl(targetDirectory, video.dashboardVideoPath) }
    : {}),
  scene_summary: video.semanticMetadata?.sceneSummary ?? null,
  clip_segments: video.semanticMetadata?.clipSegments ?? null,
  created_at: video.createdAt.toISOString(),
});

export const toRepositoryContributorResponse = (
  contributor: RepositoryContributorSummary,
): RepositoryContributorResponse => ({
  user_id: contributor.userId,
  display_name: contributor.displayName,
  video_count: contributor.videoCount,
  latest_recorded_at: contributor.latestRecordedAt ? contributor.latestRecordedAt.toISOString() : null,
});

export const toRepositoryVideoStatusResponse = (params: {
  id: string;
  repositoryId: string;
  status: VideoStatus;
  progress: RecordingFinalizeProgress | null;
  errorMessage: string | null;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
}): RepositoryVideoStatusResponse => ({
  id: params.id,
  repository_id: params.repositoryId,
  status: params.status,
  progress: normalizeProgress(params.status, params.progress),
  error_message: params.errorMessage,
  processing_started_at: params.processingStartedAt ? params.processingStartedAt.toISOString() : null,
  processing_completed_at: params.processingCompletedAt ? params.processingCompletedAt.toISOString() : null,
});
