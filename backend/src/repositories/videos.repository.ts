import { type Prisma, VideoStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";

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

  async findRepositoryContributors(repositoryId: string): Promise<Prisma.JsonValue | null> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        contributors: true,
      },
    });

    return repository?.contributors ?? null;
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

  async findUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        displayName: true,
      },
    });

    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  async deleteVideo(videoId: string): Promise<void> {
    await prisma.video.delete({ where: { id: videoId } });
  }
}

export const videosRepository = new VideosRepository();
