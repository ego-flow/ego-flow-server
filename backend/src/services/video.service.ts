import fs from "fs/promises";

import type { Prisma, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getTargetDirectory, toFileUrl, toStorageRelativePath } from "../lib/storage";
import type { AppUserRole } from "../types/auth";
import type { VideoListQueryInput } from "../schemas/video.schema";
import { processingService } from "./processing.service";
import { repositoryService } from "./repository.service";

const buildOrderBy = (query: VideoListQueryInput): Prisma.VideoOrderByWithRelationInput => {
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

const toVideoResponse = (
  targetDirectory: string,
  video: {
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
    vlmVideoPath: string | null;
    sceneSummary: string | null;
    clipSegments: Prisma.JsonValue | null;
    createdAt: Date;
  },
  repository: {
    id: string;
    name: string;
    ownerId: string;
  },
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
  thumbnail_url: toFileUrl(targetDirectory, video.thumbnailPath),
  dashboard_video_url: toFileUrl(targetDirectory, video.dashboardVideoPath),
  vlm_video_path: video.vlmVideoPath,
  scene_summary: video.sceneSummary,
  clip_segments: video.clipSegments,
  created_at: video.createdAt.toISOString(),
});

export class VideoService {
  private async getAccessibleVideo(videoId: string, requestUserId: string, requestUserRole: AppUserRole, minRole: "read" | "maintain") {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        repositoryId: true,
        status: true,
        errorMessage: true,
        processingStartedAt: true,
        processingCompletedAt: true,
      },
    });

    if (!video) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

    const access = await repositoryService.assertRepositoryAccess(
      requestUserId,
      requestUserRole,
      video.repositoryId,
      minRole,
    );

    return {
      video,
      access,
    };
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

  async listVideos(requestUserId: string, requestUserRole: AppUserRole, query: VideoListQueryInput) {
    let repositoryIds: string[] = [];

    if (query.repository_id) {
      await repositoryService.assertRepositoryAccess(requestUserId, requestUserRole, query.repository_id, "read");
      repositoryIds = [query.repository_id];
    } else {
      const repositories = await repositoryService.listAccessibleRepositories(requestUserId, requestUserRole);
      repositoryIds = repositories.repositories.map((repository) => repository.id);
    }

    if (repositoryIds.length === 0) {
      return {
        total: 0,
        page: query.page,
        limit: query.limit,
        data: [],
      };
    }

    const where: Prisma.VideoWhereInput = {
      repositoryId: { in: repositoryIds },
      ...(query.status ? { status: query.status } : {}),
    };

    const targetDirectory = getTargetDirectory();
    const [total, videos, repositories] = await Promise.all([
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
          vlmVideoPath: true,
          sceneSummary: true,
          clipSegments: true,
          createdAt: true,
        },
      }),
      prisma.repository.findMany({
        where: {
          id: { in: repositoryIds },
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
        },
      }),
    ]);

    const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));

    return {
      total,
      page: query.page,
      limit: query.limit,
      data: videos
        .map((video) => {
          const repository = repositoryMap.get(video.repositoryId);
          if (!repository) {
            return null;
          }

          return toVideoResponse(targetDirectory, video, repository);
        })
        .filter((video): video is ReturnType<typeof toVideoResponse> => Boolean(video)),
    };
  }

  async getVideoDetail(videoId: string, requestUserId: string, requestUserRole: AppUserRole) {
    const targetDirectory = getTargetDirectory();
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
        vlmVideoPath: true,
        sceneSummary: true,
        clipSegments: true,
        createdAt: true,
      },
    });

    if (!video) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

    const access = await repositoryService.assertRepositoryAccess(
      requestUserId,
      requestUserRole,
      video.repositoryId,
      "read",
    );

    return toVideoResponse(targetDirectory, video, {
      id: access.repository.id,
      name: access.repository.name,
      ownerId: access.repository.ownerId,
    });
  }

  async getVideoStatus(videoId: string, requestUserId: string, requestUserRole: AppUserRole) {
    const [{ video }, progress] = await Promise.all([
      this.getAccessibleVideo(videoId, requestUserId, requestUserRole, "read"),
      processingService.getVideoProcessingProgress(videoId),
    ]);

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

  async deleteVideo(videoId: string, requestUserId: string, requestUserRole: AppUserRole) {
    const { video } = await this.getAccessibleVideo(videoId, requestUserId, requestUserRole, "maintain");

    const targetDirectory = getTargetDirectory();
    const managedVideo = await prisma.video.findUnique({
      where: { id: video.id },
      select: {
        id: true,
        vlmVideoPath: true,
        dashboardVideoPath: true,
        thumbnailPath: true,
      },
    });

    if (!managedVideo) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

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
