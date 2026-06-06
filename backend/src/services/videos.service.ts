import fs from "fs/promises";

import { VideoStatus, type Prisma } from "@prisma/client";

import { Internal, NotFound } from "../lib/errors";
import { isMissingFileError } from "../lib/file-system";
import { toSignedFileUrl } from "../lib/signed-file-url";
import { getTargetDirectory, toStorageRelativePath } from "../lib/storage";
import {
  videosRepository,
  type RepositoryVideoRecord,
} from "../repositories/videos.repository";
import type { RepoVideoListQueryInput } from "../schemas/repository-video.schema";
import type { AppRepoRole, RepositoryRecord } from "../types/repository";
import {
  RECORDING_FINALIZE_COMPLETED_PROGRESS,
  type RecordingFinalizeProgress,
} from "../types/processing";
import { processingService } from "./processing.service";
import { normalizeContributorUserIds, refreshRepositoryContributors } from "./repository-contributors.service";

type VideoOrderQuery = {
  sort_by: "recorded_at" | "duration_sec" | "size_bytes";
  sort_order: "asc" | "desc";
};

type RepositoryContributor = {
  userId: string;
  displayName: string;
  videoCount: number;
  latestRecordedAt: Date | null;
};

type VideoRepositoryContext = Pick<RepositoryRecord, "id" | "name" | "ownerId">;
type ManifestRepositoryContext = VideoRepositoryContext & Pick<RepositoryRecord, "visibility">;

const buildOrderBy = (query: VideoOrderQuery): Prisma.VideoOrderByWithRelationInput => {
  switch (query.sort_by) {
    case "recorded_at":
      return { recordedAt: query.sort_order };
    case "duration_sec":
      return { durationSec: query.sort_order };
    case "size_bytes":
      return { sizeBytes: query.sort_order };
    default:
      return { recordedAt: query.sort_order };
  }
};

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

const toRepositoryVideoDownloadUrl = (repositoryId: string, videoId: string) =>
  `/api/v1/repositories/${repositoryId}/videos/${videoId}/download`;

const toSizeBytes = (value: bigint | number | null | undefined) => {
  if (typeof value === "bigint") {
    return Number(value);
  }

  return typeof value === "number" ? value : null;
};

const getManifestArtifactMetadata = (video: {
  id: string;
  sizeBytes: bigint | null;
  vlmSha256: string | null;
}) => {
  if (video.sizeBytes === null || !video.vlmSha256) {
    throw Internal(`Manifest metadata is missing for completed video '${video.id}'.`);
  }

  return {
    size_bytes: Number(video.sizeBytes),
    sha256: video.vlmSha256,
  };
};

const toRepoVideoResponse = (
  targetDirectory: string,
  video: RepositoryVideoRecord,
  repository: VideoRepositoryContext,
  displayNamesByUserId: Map<string, string>,
  options?: { includeDashboardVideoUrl?: boolean; processingProgress?: RecordingFinalizeProgress | null },
) => {
  return {
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
  };
};

const toContributorResponse = (contributor: RepositoryContributor) => ({
  user_id: contributor.userId,
  display_name: contributor.displayName,
  video_count: contributor.videoCount,
  latest_recorded_at: contributor.latestRecordedAt ? contributor.latestRecordedAt.toISOString() : null,
});

export class VideosService {
  private async getRepositoryVideoForResponse(repoId: string, videoId: string) {
    const video = await videosRepository.findVideoForResponse(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async getRepositoryVideoForStatus(repoId: string, videoId: string) {
    const video = await videosRepository.findVideoForStatus(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async getManagedRepositoryVideo(repoId: string, videoId: string) {
    const video = await videosRepository.findManagedVideo(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async deleteManagedFiles(targetDirectory: string, filePaths: Array<string | null>) {
    await Promise.all(
      filePaths.map(async (filePath) => {
        const relativePath = toStorageRelativePath(targetDirectory, filePath);
        if (!relativePath) {
          return;
        }

        await fs.rm(filePath as string, { force: true });
      }),
    );
  }

  private async ensureFileExists(filePath: string, missingMessage: string) {
    try {
      await fs.stat(filePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw NotFound(missingMessage);
      }

      throw error;
    }
  }

  private async getUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      return new Map<string, string>();
    }

    return videosRepository.findUserDisplayNames(uniqueUserIds);
  }

  private async getRepositoryContributors(repositoryId: string): Promise<RepositoryContributor[]> {
    const contributors = await videosRepository.findRepositoryContributors(repositoryId);
    const contributorUserIds = normalizeContributorUserIds(contributors);

    if (contributorUserIds.length === 0) {
      return [];
    }

    const contributorVideos = await videosRepository.findContributorVideos(repositoryId, contributorUserIds);

    const contributorsByUserId = new Map<string, Omit<RepositoryContributor, "displayName">>(
      contributorUserIds.map((userId) => [
        userId,
        {
          userId,
          videoCount: 0,
          latestRecordedAt: null,
        } satisfies Omit<RepositoryContributor, "displayName">,
      ]),
    );
    for (const video of contributorVideos) {
      const userId = video.recorder;
      if (!userId) {
        continue;
      }

      const latestCandidate = video.recordedAt ?? video.createdAt;
      const current = contributorsByUserId.get(userId);
      if (!current) {
        continue;
      }

      current.videoCount += 1;
      if (
        latestCandidate &&
        (!current.latestRecordedAt || latestCandidate.getTime() > current.latestRecordedAt.getTime())
      ) {
        current.latestRecordedAt = latestCandidate;
      }
    }

    const displayNamesByUserId = await this.getUserDisplayNames(Array.from(contributorsByUserId.keys()));

    return Array.from(contributorsByUserId.values())
      .map((contributor) => ({
        ...contributor,
        displayName: displayNamesByUserId.get(contributor.userId) ?? contributor.userId,
      }))
      .sort((left, right) => right.videoCount - left.videoCount || left.userId.localeCompare(right.userId));
  }

  private async getProcessingProgressByVideoId(
    videos: Array<Pick<RepositoryVideoRecord, "id" | "recordingSessionId" | "status">>,
  ): Promise<Map<string, RecordingFinalizeProgress | null>> {
    const entries = await Promise.all(
      videos.map(async (video) => {
        const progress =
          video.status === VideoStatus.PROCESSING
            ? await processingService.getRecordingFinalizeProgress(video.recordingSessionId)
            : null;

        return [video.id, progress] as const;
      }),
    );

    return new Map(entries);
  }

  async listRepositoryVideos(repository: VideoRepositoryContext, query: RepoVideoListQueryInput) {
    const targetDirectory = getTargetDirectory();
    const where: Prisma.VideoWhereInput = {
      repositoryId: repository.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contributor_user_id ? { recorder: query.contributor_user_id } : {}),
    };

    const [total, videos, contributors] = await Promise.all([
      videosRepository.countVideos(where),
      videosRepository.findVideos({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: buildOrderBy(query),
      }),
      this.getRepositoryContributors(repository.id),
    ]);

    const displayNamesByUserId = new Map(
      contributors.map((contributor) => [contributor.userId, contributor.displayName] as const),
    );
    const progressByVideoId = await this.getProcessingProgressByVideoId(videos);

    return {
      total,
      page: query.page,
      limit: query.limit,
      contributors: contributors.map(toContributorResponse),
      data: videos.map((video) =>
        toRepoVideoResponse(targetDirectory, video, repository, displayNamesByUserId, {
          processingProgress: progressByVideoId.get(video.id) ?? null,
        }),
      ),
    };
  }

  async getRepositoryVideoDetail(repoId: string, repository: VideoRepositoryContext, videoId: string) {
    const targetDirectory = getTargetDirectory();
    const video = await this.getRepositoryVideoForResponse(repoId, videoId);
    const contributorUserId = video.recorder;
    const displayNamesByUserId = await this.getUserDisplayNames(contributorUserId ? [contributorUserId] : []);
    const processingProgress =
      video.status === VideoStatus.PROCESSING
        ? await processingService.getRecordingFinalizeProgress(video.recordingSessionId)
        : null;

    return toRepoVideoResponse(targetDirectory, video, repository, displayNamesByUserId, {
      includeDashboardVideoUrl: true,
      processingProgress,
    });
  }

  async getRepositoryManifest(
    repoId: string,
    repository: ManifestRepositoryContext,
    effectiveRole: AppRepoRole,
    query: { page: number; limit: number },
  ) {
    const targetDirectory = getTargetDirectory();
    const where: Prisma.VideoWhereInput = {
      repositoryId: repoId,
      status: VideoStatus.COMPLETED,
    };

    const [total, videos] = await Promise.all([
      videosRepository.countVideos(where),
      videosRepository.findManifestVideos({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      manifest_version: "1",
      repository: {
        id: repository.id,
        owner_id: repository.ownerId,
        name: repository.name,
        visibility: repository.visibility,
        my_role: effectiveRole,
      },
      default_artifact: "vlm_video",
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        has_next: query.page * query.limit < total,
      },
      videos: videos.map((video) => {
        const artifactMetadata = getManifestArtifactMetadata(video);

        return {
          video_id: video.id,
          recorded_at: video.recordedAt ? video.recordedAt.toISOString() : null,
          duration_sec: video.durationSec,
          resolution_width: video.resolutionWidth,
          resolution_height: video.resolutionHeight,
          fps: video.fps,
          codec: video.codec,
          scene_summary: video.semanticMetadata?.sceneSummary ?? null,
          clip_segments: video.semanticMetadata?.clipSegments ?? null,
          artifacts: {
            vlm_video: {
              download_url: toRepositoryVideoDownloadUrl(repoId, video.id),
              ...artifactMetadata,
              content_type: "video/mp4",
            },
            thumbnail: video.thumbnailPath
              ? {
                  download_url: toRepositoryThumbnailUrl(targetDirectory, video),
                  content_type: "image/jpeg",
                }
              : null,
          },
        };
      }),
    };
  }

  async getRepositoryVideoStatus(repoId: string, videoId: string) {
    const video = await this.getRepositoryVideoForStatus(repoId, videoId);
    const progress = await processingService.getRecordingFinalizeProgress(video.recordingSessionId);

    return {
      id: video.id,
      repository_id: video.repositoryId,
      status: video.status,
      progress: normalizeProgress(video.status, progress),
      error_message: video.errorMessage,
      processing_started_at: video.processingStartedAt ? video.processingStartedAt.toISOString() : null,
      processing_completed_at: video.processingCompletedAt ? video.processingCompletedAt.toISOString() : null,
    };
  }

  async getRepositoryVideoDownload(repoId: string, videoId: string) {
    const video = await this.getManagedRepositoryVideo(repoId, videoId);

    if (!video.vlmVideoPath || video.status !== "COMPLETED") {
      throw NotFound("Video file is not available.");
    }

    const targetDirectory = getTargetDirectory();
    await this.ensureFileExists(video.vlmVideoPath, "Video file is not available.");
    const redirectUrl = toSignedFileUrl(targetDirectory, video.vlmVideoPath);
    if (!redirectUrl) {
      throw NotFound("Video file is not available.");
    }

    return {
      id: video.id,
      path: video.vlmVideoPath,
      sizeBytes: video.sizeBytes,
      sha256: video.vlmSha256,
      redirectUrl,
    };
  }

  async deleteRepositoryVideo(repoId: string, videoId: string) {
    const managedVideo = await this.getManagedRepositoryVideo(repoId, videoId);

    const targetDirectory = getTargetDirectory();
    await this.deleteManagedFiles(targetDirectory, [
      managedVideo.vlmVideoPath,
      managedVideo.dashboardVideoPath,
      managedVideo.thumbnailPath,
    ]);
    await videosRepository.deleteVideo(managedVideo.id);
    await refreshRepositoryContributors(repoId);

    return {
      id: managedVideo.id,
      deleted: true,
    };
  }
}

export const videosService = new VideosService();
