import { randomUUID } from "node:crypto";

import { type Prisma, VideoStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";
import {
  managedRepositoryVideoSelect,
  manifestVideoSelect,
  repositoryContributorVideoSelect,
  repositoryRenameVideoPathSelect,
  repositoryVideoPathSelect,
  repositoryVideoSelect,
  repositoryVideoStatusSelect,
  type ManagedRepositoryVideoRecord,
  type ManifestVideoRecord,
  type RepositoryContributorVideoRecord,
  type RepositoryRenameVideoPathRow,
  type RepositoryVideoPathRow,
  type RepositoryVideoRecord,
  type RepositoryVideoStatusRecord,
} from "./video-selects";

export type {
  ManagedRepositoryVideoRecord,
  ManifestVideoRecord,
  RepositoryContributorVideoRecord,
  RepositoryRenameVideoPathRow,
  RepositoryVideoPathRow,
  RepositoryVideoRecord,
  RepositoryVideoStatusRecord,
} from "./video-selects";

export class VideosRepository {
  async findVideoForResponse(videoId: string): Promise<RepositoryVideoRecord | null> {
    return prisma.videos.findUnique({
      where: { id: videoId },
      select: repositoryVideoSelect,
    });
  }

  async findVideoForStatus(videoId: string): Promise<RepositoryVideoStatusRecord | null> {
    return prisma.videos.findUnique({
      where: { id: videoId },
      select: repositoryVideoStatusSelect,
    });
  }

  async findManagedVideo(videoId: string): Promise<ManagedRepositoryVideoRecord | null> {
    return prisma.videos.findUnique({
      where: { id: videoId },
      select: managedRepositoryVideoSelect,
    });
  }

  async countVideos(where: Prisma.VideosWhereInput): Promise<number> {
    return prisma.videos.count({ where });
  }

  async countVideosByRepositoryIds(repositoryIds: string[]): Promise<Map<string, number>> {
    if (repositoryIds.length === 0) {
      return new Map();
    }

    const grouped = await prisma.videos.groupBy({
      by: ["repositoryId"],
      where: { repositoryId: { in: repositoryIds } },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.repositoryId, row._count._all]));
  }

  async findVideos(input: {
    where: Prisma.VideosWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.VideosOrderByWithRelationInput;
  }): Promise<RepositoryVideoRecord[]> {
    return prisma.videos.findMany({
      where: input.where,
      skip: input.skip,
      take: input.take,
      orderBy: input.orderBy,
      select: repositoryVideoSelect,
    });
  }

  async findManifestVideos(input: {
    where: Prisma.VideosWhereInput;
    skip: number;
    take: number;
  }): Promise<ManifestVideoRecord[]> {
    return prisma.videos.findMany({
      where: input.where,
      skip: input.skip,
      take: input.take,
      orderBy: { recordedAt: "desc" },
      select: manifestVideoSelect,
    });
  }

  async findContributorVideos(repositoryId: string, contributorUserIds: string[]): Promise<RepositoryContributorVideoRecord[]> {
    return prisma.videos.findMany({
      where: {
        repositoryId,
        recorder: { in: contributorUserIds },
      },
      select: repositoryContributorVideoSelect,
    });
  }

  async findRecorderUserIdsByRepository(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<string[]> {
    const videos = await client.videos.findMany({
      where: {
        repositoryId,
        recorder: {
          not: null,
        },
      },
      select: {
        recorder: true,
      },
    });

    return videos.map((video) => video.recorder).filter((userId): userId is string => Boolean(userId));
  }

  async findRepositoryVideoPaths(repositoryId: string): Promise<RepositoryVideoPathRow[]> {
    return prisma.videos.findMany({
      where: { repositoryId },
      select: repositoryVideoPathSelect,
    });
  }

  async findVideoPathsForRepositoryRename(repositoryId: string): Promise<RepositoryRenameVideoPathRow[]> {
    return prisma.videos.findMany({
      where: { repositoryId },
      select: repositoryRenameVideoPathSelect,
    });
  }

  async findManagedPathsStartingWith(baseDirectory: string): Promise<RepositoryRenameVideoPathRow[]> {
    return prisma.videos.findMany({
      where: {
        OR: [
          { vlmVideoPath: { startsWith: baseDirectory } },
          { dashboardVideoPath: { startsWith: baseDirectory } },
          { thumbnailPath: { startsWith: baseDirectory } },
        ],
      },
      select: repositoryRenameVideoPathSelect,
    });
  }

  async updateManagedVideoPaths(input: {
    videos: Array<{
      id: string;
      vlmVideoPath: string | null;
      dashboardVideoPath: string | null;
      thumbnailPath: string | null;
    }>;
  }): Promise<void> {
    if (input.videos.length === 0) {
      return;
    }

    await prisma.$transaction(
      input.videos.map((video) =>
        prisma.videos.update({
          where: { id: video.id },
          data: {
            vlmVideoPath: video.vlmVideoPath,
            dashboardVideoPath: video.dashboardVideoPath,
            thumbnailPath: video.thumbnailPath,
          },
        }),
      ),
    );
  }

  async updateVideoPathsForRepositoryRename(input: {
    videos: Array<{
      id: string;
      vlmVideoPath: string | null;
      dashboardVideoPath: string | null;
      thumbnailPath: string | null;
    }>;
  }): Promise<void> {
    await this.updateManagedVideoPaths(input);
  }

  async deleteVideo(videoId: string): Promise<void> {
    await prisma.videos.delete({ where: { id: videoId } });
  }

  async deleteManyByRepositoryId(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.videos.deleteMany({ where: { repositoryId } });
  }

  async upsertFailedRecording(input: {
    repositoryId: string;
    recordingSessionId: string;
    rawRecordingPath: string;
    streamPath: string | null;
    deviceType: string | null;
    recorder: string | null;
    errorMessage: string;
    processedAt: Date;
  }) {
    return prisma.videos.upsert({
      where: { recordingSessionId: input.recordingSessionId },
      create: {
        id: randomUUID(),
        repositoryId: input.repositoryId,
        recordingSessionId: input.recordingSessionId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        recorder: input.recorder,
        status: VideoStatus.FAILED,
        errorMessage: input.errorMessage,
        processingStartedAt: input.processedAt,
        processingCompletedAt: input.processedAt,
      },
      update: {
        repositoryId: input.repositoryId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        recorder: input.recorder,
        status: VideoStatus.FAILED,
        errorMessage: input.errorMessage,
        processingCompletedAt: input.processedAt,
      },
    });
  }

  async upsertFinalizeProcessing(
    input: {
      videoId: string;
      repositoryId: string;
      recordingSessionId: string;
      rawRecordingPath: string;
      streamPath: string | null;
      deviceType: string | null;
      recordedAt: Date | null;
      recorder: string | null;
      processingStartedAt: Date;
    },
    client: PrismaTransactionClient | typeof prisma = prisma,
  ) {
    return client.videos.upsert({
      where: { recordingSessionId: input.recordingSessionId },
      create: {
        id: input.videoId,
        repositoryId: input.repositoryId,
        recordingSessionId: input.recordingSessionId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        recordedAt: input.recordedAt,
        recorder: input.recorder,
        status: VideoStatus.PROCESSING,
        errorMessage: null,
        processingStartedAt: input.processingStartedAt,
        processingCompletedAt: null,
      },
      update: {
        repositoryId: input.repositoryId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        recordedAt: input.recordedAt,
        recorder: input.recorder,
        status: VideoStatus.PROCESSING,
        errorMessage: null,
        processingCompletedAt: null,
      },
    });
  }

  async upsertFinalizeCompleted(
    input: {
      videoId: string;
      repositoryId: string;
      recordingSessionId: string;
      rawRecordingPath: string;
      streamPath: string | null;
      deviceType: string | null;
      durationSec: number | null;
      resolutionWidth: number | null;
      resolutionHeight: number | null;
      fps: number | null;
      codec: string | null;
      recordedAt: Date | null;
      vlmVideoPath: string;
      dashboardVideoPath: string;
      thumbnailPath: string;
      sizeBytes: bigint;
      vlmSha256: string;
      recorder: string | null;
      processedAt: Date;
    },
    client: PrismaTransactionClient | typeof prisma = prisma,
  ) {
    return client.videos.upsert({
      where: { recordingSessionId: input.recordingSessionId },
      create: {
        id: input.videoId,
        repositoryId: input.repositoryId,
        recordingSessionId: input.recordingSessionId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        durationSec: input.durationSec,
        resolutionWidth: input.resolutionWidth,
        resolutionHeight: input.resolutionHeight,
        fps: input.fps,
        codec: input.codec,
        recordedAt: input.recordedAt,
        vlmVideoPath: input.vlmVideoPath,
        dashboardVideoPath: input.dashboardVideoPath,
        thumbnailPath: input.thumbnailPath,
        sizeBytes: input.sizeBytes,
        vlmSha256: input.vlmSha256,
        recorder: input.recorder,
        status: VideoStatus.COMPLETED,
        errorMessage: null,
        processingStartedAt: input.processedAt,
        processingCompletedAt: input.processedAt,
      },
      update: {
        repositoryId: input.repositoryId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        durationSec: input.durationSec,
        resolutionWidth: input.resolutionWidth,
        resolutionHeight: input.resolutionHeight,
        fps: input.fps,
        codec: input.codec,
        recordedAt: input.recordedAt,
        vlmVideoPath: input.vlmVideoPath,
        dashboardVideoPath: input.dashboardVideoPath,
        thumbnailPath: input.thumbnailPath,
        sizeBytes: input.sizeBytes,
        vlmSha256: input.vlmSha256,
        recorder: input.recorder,
        status: VideoStatus.COMPLETED,
        errorMessage: null,
        processingCompletedAt: input.processedAt,
      },
    });
  }

  async upsertFinalizeFailed(
    input: {
      videoId: string;
      repositoryId: string;
      recordingSessionId: string;
      rawRecordingPath: string;
      streamPath: string | null;
      deviceType: string | null;
      errorMessage: string;
      processedAt: Date;
    },
    client: PrismaTransactionClient | typeof prisma = prisma,
  ) {
    return client.videos.upsert({
      where: { recordingSessionId: input.recordingSessionId },
      create: {
        id: input.videoId,
        repositoryId: input.repositoryId,
        recordingSessionId: input.recordingSessionId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        status: VideoStatus.FAILED,
        errorMessage: input.errorMessage,
        processingStartedAt: input.processedAt,
        processingCompletedAt: input.processedAt,
      },
      update: {
        repositoryId: input.repositoryId,
        rawRecordingPath: input.rawRecordingPath,
        streamPath: input.streamPath,
        deviceType: input.deviceType,
        status: VideoStatus.FAILED,
        errorMessage: input.errorMessage,
        processingCompletedAt: input.processedAt,
      },
    });
  }
}

export const videosRepository = new VideosRepository();
