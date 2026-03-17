import path from "path";

import type { Prisma } from "@prisma/client";

import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import type { VideoListQueryInput } from "../schemas/video.schema";

const getTargetDirectory = async (): Promise<string> => {
  const setting = await prisma.setting.findUnique({ where: { key: "target_directory" } });
  return setting?.value || env.TARGET_DIRECTORY;
};

const toFileUrl = (targetDirectory: string, filePath: string | null): string | null => {
  if (!filePath) {
    return null;
  }

  const base = path.resolve(targetDirectory);
  const resolved = path.resolve(filePath);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
  return `/files/${encoded}`;
};

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

export class VideoService {
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
      data: videos.map((video) => ({
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
      })),
    };
  }
}

export const videoService = new VideoService();
