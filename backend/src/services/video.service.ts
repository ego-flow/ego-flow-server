import fs from "fs/promises";

import type { Prisma, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { toSignedFileUrl } from "../lib/signed-file-url";
import { getTargetDirectory, toStorageRelativePath } from "../lib/storage";
import type { RepoVideoListQueryInput } from "../schemas/repository-video.schema";
import type { RepositoryRecord } from "../types/repository";
import { processingService } from "./processing.service";

type VideoOrderQuery = {
  sort_by: "created_at" | "recorded_at" | "duration_sec";
  sort_order: "asc" | "desc";
};

type RepositoryVideoRecord = {
  id: string;
  repositoryId: string;
  status: VideoStatus;
  durationSec: number | null;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  fps: number | null;
  codec: string | null;
  recordedAt: Date | null;
  thumbnailPath: string | null;
  dashboardVideoPath: string | null;
  sceneSummary: string | null;
  clipSegments: Prisma.JsonValue | null;
  createdAt: Date;
};

type VideoRepositoryContext = Pick<RepositoryRecord, "id" | "name" | "ownerId">;

const buildOrderBy = (query: VideoOrderQuery): Prisma.VideoOrderByWithRelationInput => {
  switch (query.sort_by) {
    case "recorded_at":
      return { recordedAt: query.sort_order };
    case "duration_sec":
      return { durationSec: query.sort_order };
    case "created_at":
    default:
      return { createdAt: query.sort_order };
  }
};

const normalizeProgress = (status: VideoStatus, progress: number | null): number => {
  if (typeof progress === "number") {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  switch (status) {
    case "COMPLETED":
      return 100;
    case "PROCESSING":
      return 0;
    case "FAILED":
    case "PENDING":
    default:
      return 0;
  }
};

const toRepositoryThumbnailUrl = (repositoryId: string, videoId: string) =>
  `/api/v1/repositories/${repositoryId}/videos/${videoId}/thumbnail`;

const toRepoVideoResponse = (
  targetDirectory: string,
  video: RepositoryVideoRecord,
  repository: VideoRepositoryContext,
  options?: { includeDashboardVideoUrl?: boolean },
) => ({
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
  thumbnail_url: video.thumbnailPath ? toRepositoryThumbnailUrl(repository.id, video.id) : null,
  ...(options?.includeDashboardVideoUrl
    ? { dashboard_video_url: toSignedFileUrl(targetDirectory, video.dashboardVideoPath) }
    : {}),
  scene_summary: video.sceneSummary,
  clip_segments: video.clipSegments,
  created_at: video.createdAt.toISOString(),
});

export class VideoService {
  private async getRepositoryVideoForResponse(repoId: string, videoId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        repositoryId: true,
        status: true,
        durationSec: true,
        resolutionWidth: true,
        resolutionHeight: true,
        fps: true,
        codec: true,
        recordedAt: true,
        thumbnailPath: true,
        dashboardVideoPath: true,
        sceneSummary: true,
        clipSegments: true,
        createdAt: true,
      },
    });

    if (!video || video.repositoryId !== repoId) {
      throw new AppError(404, "NOT_FOUND", "Video not found in this repository.");
    }

    return video;
  }

  private async getRepositoryVideoForStatus(repoId: string, videoId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        repositoryId: true,
        recordingSessionId: true,
        status: true,
        errorMessage: true,
        processingStartedAt: true,
        processingCompletedAt: true,
      },
    });

    if (!video || video.repositoryId !== repoId) {
      throw new AppError(404, "NOT_FOUND", "Video not found in this repository.");
    }

    return video;
  }

  private async getManagedRepositoryVideo(repoId: string, videoId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        repositoryId: true,
        status: true,
        vlmVideoPath: true,
        dashboardVideoPath: true,
        thumbnailPath: true,
        vlmSizeBytes: true,
        vlmSha256: true,
      },
    });

    if (!video || video.repositoryId !== repoId) {
      throw new AppError(404, "NOT_FOUND", "Video not found in this repository.");
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

  async listRepositoryVideos(repository: VideoRepositoryContext, query: RepoVideoListQueryInput) {
    const targetDirectory = getTargetDirectory();
    const where: Prisma.VideoWhereInput = {
      repositoryId: repository.id,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, videos] = await Promise.all([
      prisma.video.count({ where }),
      prisma.video.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: buildOrderBy(query),
        select: {
          id: true,
          repositoryId: true,
          status: true,
          durationSec: true,
          resolutionWidth: true,
          resolutionHeight: true,
          fps: true,
          codec: true,
          recordedAt: true,
          thumbnailPath: true,
          dashboardVideoPath: true,
          sceneSummary: true,
          clipSegments: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      total,
      page: query.page,
      limit: query.limit,
      data: videos.map((video) => toRepoVideoResponse(targetDirectory, video, repository)),
    };
  }

  async getRepositoryVideoDetail(repoId: string, repository: VideoRepositoryContext, videoId: string) {
    const targetDirectory = getTargetDirectory();
    const video = await this.getRepositoryVideoForResponse(repoId, videoId);
    return toRepoVideoResponse(targetDirectory, video, repository, {
      includeDashboardVideoUrl: true,
    });
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
      throw new AppError(404, "NOT_FOUND", "Video file is not available.");
    }

    return {
      id: video.id,
      path: video.vlmVideoPath,
      sizeBytes: video.vlmSizeBytes,
      sha256: video.vlmSha256,
    };
  }

  async getRepositoryVideoThumbnail(repoId: string, videoId: string) {
    const video = await this.getManagedRepositoryVideo(repoId, videoId);

    if (!video.thumbnailPath) {
      throw new AppError(404, "NOT_FOUND", "Thumbnail is not available.");
    }

    return {
      id: video.id,
      path: video.thumbnailPath,
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
    await prisma.video.delete({ where: { id: managedVideo.id } });

    return {
      id: managedVideo.id,
      deleted: true,
    };
  }
}

export const videoService = new VideoService();
