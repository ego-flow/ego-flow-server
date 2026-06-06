import { randomUUID } from "node:crypto";

import { type Prisma, VideoStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/prisma";

const repositoryVideoSelect = {
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
      sceneSummary: true,
      clipSegments: true,
    },
  },
  createdAt: true,
} satisfies Prisma.VideoSelect;

const repositoryVideoStatusSelect = {
  id: true,
  repositoryId: true,
  recordingSessionId: true,
  status: true,
  errorMessage: true,
  processingStartedAt: true,
  processingCompletedAt: true,
} satisfies Prisma.VideoSelect;

const managedRepositoryVideoSelect = {
  id: true,
  repositoryId: true,
  status: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
  sizeBytes: true,
  vlmSha256: true,
} satisfies Prisma.VideoSelect;

const manifestVideoSelect = {
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
} satisfies Prisma.VideoSelect;

const repositoryVideoPathSelect = {
  id: true,
  rawRecordingPath: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
} satisfies Prisma.VideoSelect;

const repositoryRenameVideoPathSelect = {
  id: true,
  vlmVideoPath: true,
  dashboardVideoPath: true,
  thumbnailPath: true,
} satisfies Prisma.VideoSelect;

export type RepositoryVideoRecord = Prisma.VideoGetPayload<{
  select: typeof repositoryVideoSelect;
}>;

export type RepositoryVideoStatusRecord = Prisma.VideoGetPayload<{
  select: typeof repositoryVideoStatusSelect;
}>;

export type ManagedRepositoryVideoRecord = Prisma.VideoGetPayload<{
  select: typeof managedRepositoryVideoSelect;
}>;

export type ManifestVideoRecord = Prisma.VideoGetPayload<{
  select: typeof manifestVideoSelect;
}>;

export type RepositoryVideoPathRow = Prisma.VideoGetPayload<{
  select: typeof repositoryVideoPathSelect;
}>;

export type RepositoryRenameVideoPathRow = Prisma.VideoGetPayload<{
  select: typeof repositoryRenameVideoPathSelect;
}>;

export type RepositoryContributorVideoRecord = Pick<RepositoryVideoRecord, "recorder" | "recordedAt" | "createdAt">;

export class VideosRepository {
  async findVideoForResponse(videoId: string): Promise<RepositoryVideoRecord | null> {
    return prisma.video.findUnique({
      where: { id: videoId },
      select: repositoryVideoSelect,
    });
  }

  async findVideoForStatus(videoId: string): Promise<RepositoryVideoStatusRecord | null> {
    return prisma.video.findUnique({
      where: { id: videoId },
      select: repositoryVideoStatusSelect,
    });
  }

  async findManagedVideo(videoId: string): Promise<ManagedRepositoryVideoRecord | null> {
    return prisma.video.findUnique({
      where: { id: videoId },
      select: managedRepositoryVideoSelect,
    });
  }

  async countVideos(where: Prisma.VideoWhereInput): Promise<number> {
    return prisma.video.count({ where });
  }

  async countVideosByRepositoryIds(repositoryIds: string[]): Promise<Map<string, number>> {
    if (repositoryIds.length === 0) {
      return new Map();
    }

    const grouped = await prisma.video.groupBy({
      by: ["repositoryId"],
      where: { repositoryId: { in: repositoryIds } },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.repositoryId, row._count._all]));
  }

  async findVideos(input: {
    where: Prisma.VideoWhereInput;
    skip: number;
    take: number;
    orderBy: Prisma.VideoOrderByWithRelationInput;
  }): Promise<RepositoryVideoRecord[]> {
    return prisma.video.findMany({
      where: input.where,
      skip: input.skip,
      take: input.take,
      orderBy: input.orderBy,
      select: repositoryVideoSelect,
    });
  }

  async findManifestVideos(input: {
    where: Prisma.VideoWhereInput;
    skip: number;
    take: number;
  }): Promise<ManifestVideoRecord[]> {
    return prisma.video.findMany({
      where: input.where,
      skip: input.skip,
      take: input.take,
      orderBy: { recordedAt: "desc" },
      select: manifestVideoSelect,
    });
  }

  async findContributorVideos(repositoryId: string, contributorUserIds: string[]): Promise<RepositoryContributorVideoRecord[]> {
    return prisma.video.findMany({
      where: {
        repositoryId,
        recorder: { in: contributorUserIds },
      },
      select: {
        recorder: true,
        recordedAt: true,
        createdAt: true,
      },
    });
  }

  async findRepositoryVideoPaths(repositoryId: string): Promise<RepositoryVideoPathRow[]> {
    return prisma.video.findMany({
      where: { repositoryId },
      select: repositoryVideoPathSelect,
    });
  }

  async findVideoPathsForRepositoryRename(repositoryId: string): Promise<RepositoryRenameVideoPathRow[]> {
    return prisma.video.findMany({
      where: { repositoryId },
      select: repositoryRenameVideoPathSelect,
    });
  }

  async updateVideoPathsForRepositoryRename(input: {
    videos: Array<{
      id: string;
      vlmVideoPath: string | null;
      dashboardVideoPath: string | null;
      thumbnailPath: string | null;
    }>;
  }): Promise<void> {
    await prisma.$transaction(
      input.videos.map((video) =>
        prisma.video.update({
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

  async deleteVideo(videoId: string): Promise<void> {
    await prisma.video.delete({ where: { id: videoId } });
  }

  async deleteManyByRepositoryId(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.video.deleteMany({ where: { repositoryId } });
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
    return prisma.video.upsert({
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
}

export const videosRepository = new VideosRepository();
