import {
  Prisma,
  RecordingSegmentStatus,
  RecordingSessionStatus,
  RepoRole,
  RepoVisibility,
} from "@prisma/client";

import { prisma } from "../lib/prisma";

const repositorySummarySelect = {
  id: true,
  name: true,
  ownerId: true,
  visibility: true,
  description: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RepositorySelect;

const repositoryResolveSelect = {
  ...repositorySummarySelect,
  deactivated: true,
} satisfies Prisma.RepositorySelect;

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

const repositoryMemberSelect = {
  userId: true,
  role: true,
  createdAt: true,
} satisfies Prisma.RepoMemberSelect;

const userSummarySelect = {
  id: true,
  displayName: true,
  deactivated: true,
} satisfies Prisma.UserSelect;

export type RepositorySummaryRow = Prisma.RepositoryGetPayload<{
  select: typeof repositorySummarySelect;
}>;

export type RepositoryResolveRow = Prisma.RepositoryGetPayload<{
  select: typeof repositoryResolveSelect;
}>;

export type RepositoryVideoPathRow = Prisma.VideoGetPayload<{
  select: typeof repositoryVideoPathSelect;
}>;

export type RepositoryRenameVideoPathRow = Prisma.VideoGetPayload<{
  select: typeof repositoryRenameVideoPathSelect;
}>;

export type RepositoryMemberRow = Prisma.RepoMemberGetPayload<{
  select: typeof repositoryMemberSelect;
}>;

export type UserSummaryRow = Prisma.UserGetPayload<{
  select: typeof userSummarySelect;
}>;

export type RepositoryDeleteState = {
  activeStreamingSessionCount: number;
  finalizingSegmentCount: number;
};

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class RepositoriesRepository {
  async findActiveRepositoryIds(): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: { deactivated: false },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActiveRepositoryIdsByIds(repositoryIds: string[]): Promise<string[]> {
    if (repositoryIds.length === 0) {
      return [];
    }

    const repositories = await prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        deactivated: false,
      },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActivePublicRepositoryIds(): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: {
        visibility: RepoVisibility.public,
        deactivated: false,
      },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActiveRepositorySummaries(): Promise<RepositorySummaryRow[]> {
    return prisma.repository.findMany({
      where: { deactivated: false },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findActiveRepositorySummariesForAccess(input: {
    memberRepositoryIds: string[];
    includePublic: boolean;
  }): Promise<RepositorySummaryRow[]> {
    const accessWhere: Prisma.RepositoryWhereInput = input.includePublic
      ? {
          OR: [
            { visibility: RepoVisibility.public },
            { id: { in: input.memberRepositoryIds } },
          ],
        }
      : {
          id: { in: input.memberRepositoryIds },
        };

    return prisma.repository.findMany({
      where: {
        AND: [
          { deactivated: false },
          accessWhere,
        ],
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findRepositoryByOwnerAndName(ownerId: string, name: string): Promise<RepositoryResolveRow | null> {
    return prisma.repository.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name,
        },
      },
      select: repositoryResolveSelect,
    });
  }

  async createRepository(input: {
    name: string;
    ownerId: string;
    visibility: RepoVisibility;
    description: string | null;
    tags: Prisma.InputJsonValue;
    contributors: Prisma.InputJsonValue;
  }): Promise<RepositorySummaryRow> {
    return prisma.repository.create({
      data: input,
      select: repositorySummarySelect,
    });
  }

  async updateRepository(input: {
    repositoryId: string;
    name: string;
    visibility: RepoVisibility;
    description: string | null;
    tags: Prisma.InputJsonValue;
  }): Promise<RepositorySummaryRow> {
    return prisma.repository.update({
      where: { id: input.repositoryId },
      data: {
        name: input.name,
        visibility: input.visibility,
        description: input.description,
        tags: input.tags,
      },
      select: repositorySummarySelect,
    });
  }

  async markRepositoryDeactivated(repositoryId: string): Promise<void> {
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { deactivated: true },
    });
  }

  async createRepositoryAdminMember(repositoryId: string, userId: string): Promise<void> {
    await prisma.repoMember.create({
      data: {
        repositoryId,
        userId,
        role: RepoRole.admin,
      },
    });
  }

  async findMembershipRolesByUser(userId: string): Promise<Array<{ repositoryId: string; role: RepoRole }>> {
    return prisma.repoMember.findMany({
      where: { userId },
      select: {
        repositoryId: true,
        role: true,
      },
    });
  }

  async findDeactivatedRepositorySummariesForSystemAdmin(): Promise<RepositorySummaryRow[]> {
    return prisma.repository.findMany({
      where: { deactivated: true },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findAdminRepositoryIdsByUser(userId: string): Promise<string[]> {
    const memberships = await prisma.repoMember.findMany({
      where: {
        userId,
        role: RepoRole.admin,
      },
      select: { repositoryId: true },
    });

    return memberships.map((membership) => membership.repositoryId);
  }

  async findDeactivatedRepositorySummariesByIds(repositoryIds: string[]): Promise<RepositorySummaryRow[]> {
    if (repositoryIds.length === 0) {
      return [];
    }

    return prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        deactivated: true,
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
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

  async getRepositoryDeleteState(repositoryId: string): Promise<RepositoryDeleteState> {
    const [activeStreamingSessionCount, finalizingSegmentCount] = await Promise.all([
      prisma.recordingSession.count({
        where: {
          repositoryId,
          status: RecordingSessionStatus.STREAMING,
        },
      }),
      prisma.recordingSegment.count({
        where: {
          status: {
            in: [
              RecordingSegmentStatus.WRITE_DONE,
              RecordingSegmentStatus.PROCESSING,
            ],
          },
          recordingSession: {
            repositoryId,
          },
        },
      }),
    ]);

    return {
      activeStreamingSessionCount,
      finalizingSegmentCount,
    };
  }

  async findRepositoryVideoPaths(repositoryId: string): Promise<RepositoryVideoPathRow[]> {
    return prisma.video.findMany({
      where: { repositoryId },
      select: repositoryVideoPathSelect,
    });
  }

  async deleteRepositoryGraph(repositoryId: string): Promise<void> {
    await prisma.$transaction([
      prisma.repoMember.deleteMany({ where: { repositoryId } }),
      prisma.video.deleteMany({ where: { repositoryId } }),
      prisma.recordingSegment.deleteMany({
        where: { recordingSession: { repositoryId } },
      }),
      prisma.recordingSession.deleteMany({ where: { repositoryId } }),
      prisma.repository.delete({ where: { id: repositoryId } }),
    ]);
  }

  async findRepositoryMembers(repositoryId: string): Promise<RepositoryMemberRow[]> {
    return prisma.repoMember.findMany({
      where: { repositoryId },
      orderBy: [{ role: "desc" }, { userId: "asc" }],
      select: repositoryMemberSelect,
    });
  }

  async findUserSummaries(userIds: string[]): Promise<UserSummaryRow[]> {
    if (userIds.length === 0) {
      return [];
    }

    return prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: userSummarySelect,
    });
  }

  async upsertRepositoryMember(input: {
    repositoryId: string;
    userId: string;
    role: RepoRole;
  }): Promise<void> {
    await prisma.repoMember.upsert({
      where: {
        repositoryId_userId: {
          repositoryId: input.repositoryId,
          userId: input.userId,
        },
      },
      update: {
        role: input.role,
      },
      create: {
        repositoryId: input.repositoryId,
        userId: input.userId,
        role: input.role,
      },
    });
  }

  async findRepositoryMembership(repositoryId: string, userId: string): Promise<{ userId: string } | null> {
    return prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
      select: { userId: true },
    });
  }

  async updateRepositoryMemberRole(input: {
    repositoryId: string;
    userId: string;
    role: RepoRole;
  }): Promise<void> {
    await prisma.repoMember.update({
      where: {
        repositoryId_userId: {
          repositoryId: input.repositoryId,
          userId: input.userId,
        },
      },
      data: {
        role: input.role,
      },
    });
  }

  async deleteRepositoryMember(repositoryId: string, userId: string): Promise<void> {
    await prisma.repoMember.delete({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
    });
  }

  async findActiveUserState(userId: string): Promise<{ id: string; deactivated: boolean } | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        deactivated: true,
      },
    });
  }

  async hasOpenRecordingSession(input: {
    repositoryId: string;
    blockPending: boolean;
  }): Promise<boolean> {
    const sessionStatusFilter = input.blockPending
      ? {
          in: [
            RecordingSessionStatus.PENDING,
            RecordingSessionStatus.STREAMING,
          ],
        }
      : RecordingSessionStatus.STREAMING;

    const activeSession = await prisma.recordingSession.findFirst({
      where: {
        repositoryId: input.repositoryId,
        status: sessionStatusFilter,
      },
      select: { id: true },
    });

    return Boolean(activeSession);
  }

  async hasFinalizingRecordingSegment(repositoryId: string): Promise<boolean> {
    const finalizingSegment = await prisma.recordingSegment.findFirst({
      where: {
        status: {
          in: [
            RecordingSegmentStatus.WRITE_DONE,
            RecordingSegmentStatus.PROCESSING,
          ],
        },
        recordingSession: {
          repositoryId,
        },
      },
      select: { id: true },
    });

    return Boolean(finalizingSegment);
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
}

export const repositoriesRepository = new RepositoriesRepository();
