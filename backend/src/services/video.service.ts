import fs from "fs/promises";

import type { Prisma, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getTargetDirectory, toFileUrl, toStorageRelativePath } from "../lib/storage";
import type { VideoListQueryInput } from "../schemas/video.schema";
import { processingService } from "./processing.service";

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
    videoKey: string;
    userId: string;
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
) => ({
  id: video.id,
  video_key: video.videoKey,
  user_id: video.userId,
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
  private async getAccessibleVideo(videoId: string, requestUserId: string, requestUserRole: "admin" | "user") {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        userId: true,
        status: true,
        errorMessage: true,
        processingStartedAt: true,
        processingCompletedAt: true,
      },
    });

    if (!video) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

    if (requestUserRole !== "admin" && video.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "You do not have access to this video.");
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

  async listVideos(requestUserId: string, requestUserRole: "admin" | "user", query: VideoListQueryInput) {
    const where: Prisma.VideoWhereInput = {
      ...(query.video_key ? { videoKey: query.video_key } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    if (requestUserRole === "admin") {
      if (query.user_id) {
        where.userId = query.user_id;
      }
    } else {
      where.userId = requestUserId;
    }

    const [targetDirectory, total, videos] = await Promise.all([
      getTargetDirectory(),
      prisma.video.count({ where }),
      prisma.video.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: buildOrderBy(query),
        select: {
          id: true,
          videoKey: true,
          userId: true,
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
    ]);

    return {
      total,
      page: query.page,
      limit: query.limit,
      data: videos.map((video) => toVideoResponse(targetDirectory, video)),
    };
  }

  async getVideoDetail(videoId: string, requestUserId: string, requestUserRole: "admin" | "user") {
    const [targetDirectory, video] = await Promise.all([
      getTargetDirectory(),
      prisma.video.findUnique({
        where: { id: videoId },
        select: {
          id: true,
          videoKey: true,
          userId: true,
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
    ]);

    if (!video) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

    if (requestUserRole !== "admin" && video.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "You do not have access to this video.");
    }

    return toVideoResponse(targetDirectory, video);
  }

  async getVideoStatus(videoId: string, requestUserId: string, requestUserRole: "admin" | "user") {
    const [video, progress] = await Promise.all([
      this.getAccessibleVideo(videoId, requestUserId, requestUserRole),
      processingService.getVideoProcessingProgress(videoId),
    ]);

    return {
      id: video.id,
      status: video.status,
      progress: normalizeProgress(video.status, progress),
      error_message: video.errorMessage,
      processing_started_at: video.processingStartedAt ? video.processingStartedAt.toISOString() : null,
      processing_completed_at: video.processingCompletedAt ? video.processingCompletedAt.toISOString() : null,
    };
  }

  async deleteVideo(videoId: string, requestUserId: string, requestUserRole: "admin" | "user") {
    const [targetDirectory, video] = await Promise.all([
      getTargetDirectory(),
      prisma.video.findUnique({
        where: { id: videoId },
        select: {
          id: true,
          userId: true,
          vlmVideoPath: true,
          dashboardVideoPath: true,
          thumbnailPath: true,
        },
      }),
    ]);

    if (!video) {
      throw new AppError(404, "NOT_FOUND", "Video not found.");
    }

    if (requestUserRole !== "admin" && video.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "You do not have access to this video.");
    }

    await this.deleteManagedFiles(targetDirectory, [video.vlmVideoPath, video.dashboardVideoPath, video.thumbnailPath]);
    await prisma.video.delete({ where: { id: video.id } });

    return {
      id: video.id,
      deleted: true,
    };
  }
}

export const videoService = new VideoService();
