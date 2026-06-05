import fs from "fs/promises";
import path from "path";

import { Prisma, RecordingSegmentStatus, RecordingSessionStatus, RepoRole, RepoVisibility } from "@prisma/client";

import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getRepositoryAccessPolicy, type RepositoryActiveAccessAction } from "../lib/repository-access-policy";
import { isRepoRoleAtLeast, toAppRepoRole } from "../lib/repository-roles";
import { getTargetDirectory } from "../lib/storage";
import { normalizeRepositoryTags, toRepositoryRecord } from "../mappers/repository.mapper";
import type {
  CreateRepositoryInput,
  CreateRepositoryMemberInput,
  UpdateRepositoryInput,
  UpdateRepositoryMemberInput,
} from "../schemas/repository.schema";
import type { AppUserRole } from "../types/auth";
import type { AppRepoRole, RepositoryAccessContext, RepositoryRecord } from "../types/repository";
import { movePath, pathExists } from "../lib/file-system";
import { remapPathWithinDirectory } from "../lib/path-mapping";
import { repositoryAccessService } from "./repository-access.service";
import { refreshRepositoryContributors } from "./repository-contributors.service";

const toRepositoryResponse = (
  repository: RepositoryRecord,
  effectiveRole: AppRepoRole,
) => ({
  id: repository.id,
  name: repository.name,
  owner_id: repository.ownerId,
  visibility: repository.visibility,
  description: repository.description,
  tags: repository.tags,
  my_role: effectiveRole,
  created_at: repository.createdAt.toISOString(),
  updated_at: repository.updatedAt.toISOString(),
});

const toRepositorySummary = (
  repository: RepositoryRecord,
  effectiveRole: AppRepoRole,
  videoCount: number,
) => ({
  ...toRepositoryResponse(repository, effectiveRole),
  video_count: videoCount,
});

const normalizeDescription = (description: string | null | undefined): string | null => {
  if (description === undefined || description === null) {
    return description ?? null;
  }

  const trimmed = description.trim();
  return trimmed ? trimmed : null;
};

const isConflictError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

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

type RepositorySummaryRow = Prisma.RepositoryGetPayload<{
  select: typeof repositorySummarySelect;
}>;

type AccessibleRepositoryEntry = {
  record: RepositoryRecord;
  effectiveRole: AppRepoRole;
};

export class RepositoryService {
  async listAccessibleRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await this.getAccessibleRepositories(userId, userRole, "repository.list"),
    };
  }

  /**
   * [접근 가능한 repository id 집합]
   * /live API filter를 위해 호출자 권한으로 read 가능한 repository id 집합을 계산한다.
   * - admin: deactivated=false repository id 전체
   * - 일반 사용자: owner / member / public repository id의 합집합
   */
  async listAccessibleRepositoryIds(
    userId: string,
    userRole: AppUserRole,
    action: RepositoryActiveAccessAction = "repository.list",
  ): Promise<Set<string> | null> {
    const policy = getRepositoryAccessPolicy(action);

    if (userRole === "admin") {
      const repositories = await prisma.repository.findMany({
        where: { deactivated: false },
        select: { id: true },
      });
      return new Set(repositories.map((repository) => repository.id));
    }

    const membershipRoleMap = await this.getMembershipRoleMap(userId);
    const memberRepoIds = this.getRepositoryIdsWithRoleAtLeast(membershipRoleMap, policy.minRole);

    const [memberRepos, publicRepos] = await Promise.all([
      prisma.repository.findMany({
        where: {
          id: { in: memberRepoIds },
          deactivated: false,
        },
        select: { id: true },
      }),
      this.allowsPublicReadFallback(policy.minRole)
        ? prisma.repository.findMany({
            where: {
              visibility: RepoVisibility.public,
              deactivated: false,
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const accessible = new Set<string>();
    for (const repo of memberRepos) {
      accessible.add(repo.id);
    }
    for (const repo of publicRepos) {
      accessible.add(repo.id);
    }

    return accessible;
  }

  async listMaintainedRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await this.getAccessibleRepositories(userId, userRole, "repository.listMaintained"),
    };
  }

  async listDeactivatedAdminRepositories(userId: string, userRole: AppUserRole) {
    const repositories = await this.getDeactivatedAdminRepositories(userId, userRole);
    const videoCounts = await this.getVideoCountsByRepositoryId(repositories.map((repository) => repository.id));

    return {
      repositories: repositories.map((repository) =>
        toRepositorySummary(toRepositoryRecord(repository), "admin", videoCounts.get(repository.id) ?? 0),
      ),
    };
  }

  async getRepositoryDetail(access: RepositoryAccessContext) {
    return {
      repository: toRepositoryResponse(access.repository, access.effectiveRole),
    };
  }

  async resolveRepository(
    requestUserId: string,
    requestUserRole: AppUserRole,
    ownerId: string,
    repoName: string,
  ) {
    const repository = await prisma.repository.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name: repoName,
        },
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        description: true,
        tags: true,
        deactivated: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!repository || repository.deactivated) {
      throw NotFound("Repository not found.");
    }

    const access = await repositoryAccessService.getAccessForAction(
      requestUserId,
      requestUserRole,
      repository.id,
      "repository.read",
    );
    if (!access) {
      throw NotFound("Repository not found.");
    }

    return {
      repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
    };
  }

  async createRepository(userId: string, input: CreateRepositoryInput) {
    try {
      const repository = await prisma.repository.create({
        data: {
          name: input.name,
          ownerId: userId,
          visibility: input.visibility,
          description: normalizeDescription(input.description),
          tags: normalizeRepositoryTags(input.tags),
          contributors: [userId],
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await prisma.repoMember.create({
        data: {
          repositoryId: repository.id,
          userId,
          role: RepoRole.admin,
        },
      });

      return {
        repository: toRepositoryResponse(toRepositoryRecord(repository), "admin"),
      };
    } catch (error) {
      if (isConflictError(error)) {
        throw Conflict("Repository name already exists for this owner.");
      }

      throw error;
    }
  }

  async updateRepository(
    access: RepositoryAccessContext,
    input: UpdateRepositoryInput,
  ) {
    const previousRepository = access.repository;
    const repositoryId = previousRepository.id;
    const nextName = input.name ?? previousRepository.name;
    const nextVisibility = input.visibility ?? previousRepository.visibility;
    const nextDescription =
      input.description === undefined ? previousRepository.description : normalizeDescription(input.description);
    const nextTags = input.tags === undefined ? previousRepository.tags : normalizeRepositoryTags(input.tags);

    if (
      nextName === previousRepository.name &&
      nextVisibility === previousRepository.visibility &&
      nextDescription === previousRepository.description &&
      JSON.stringify(nextTags) === JSON.stringify(previousRepository.tags)
    ) {
      return {
        repository: toRepositoryResponse(previousRepository, access.effectiveRole),
      };
    }

    if (nextName !== previousRepository.name) {
      await this.ensureRepositoryIsIdle(previousRepository.id, previousRepository.name);
      await this.renameRepositoryDirectory(previousRepository.ownerId, previousRepository.name, nextName, repositoryId);
    }

    try {
      const repository = await prisma.repository.update({
        where: { id: repositoryId },
        data: {
          name: nextName,
          visibility: nextVisibility === "public" ? RepoVisibility.public : RepoVisibility.private,
          description: nextDescription,
          tags: nextTags,
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
      };
    } catch (error) {
      if (isConflictError(error)) {
        throw Conflict("Repository name already exists for this owner.");
      }

      throw error;
    }
  }

  async deactivateRepository(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;

    await prisma.repository.update({
      where: { id: repositoryId },
      data: { deactivated: true },
    });

    return {
      id: repositoryId,
      deactivated: true,
    };
  }

  async getRepositoryDeleteReadiness(access: RepositoryAccessContext) {
    const state = await this.getRepositoryPermanentDeleteState(access);

    return {
      repository_id: access.repository.id,
      can_delete: state.canDelete,
      checks: {
        is_deactivated: true,
        active_streaming_session_count: state.activeStreamingSessionCount,
        finalizing_segment_count: state.finalizingSegmentCount,
      },
    };
  }

  async permanentlyDeleteRepository(access: RepositoryAccessContext) {
    const state = await this.getRepositoryPermanentDeleteState(access);
    const repositoryId = access.repository.id;

    if (state.activeStreamingSessionCount > 0 || state.finalizingSegmentCount > 0) {
      throw Conflict(
        "Repository cannot be permanently deleted while streams or recording finalization are active.",
      );
    }

    const videos = await prisma.video.findMany({
      where: { repositoryId },
      select: {
        rawRecordingPath: true,
        vlmVideoPath: true,
        dashboardVideoPath: true,
        thumbnailPath: true,
      },
    });

    await Promise.all(
      videos.flatMap((video) =>
        [video.rawRecordingPath, video.vlmVideoPath, video.dashboardVideoPath, video.thumbnailPath]
          .filter((filePath): filePath is string => Boolean(filePath))
          .map((filePath) => fs.rm(filePath, { force: true, recursive: true })),
      ),
    );

    const repositoryDir = path.join(getTargetDirectory(), access.repository.ownerId, access.repository.name);
    await fs.rm(repositoryDir, { recursive: true, force: true });

    await prisma.$transaction([
      prisma.repoMember.deleteMany({ where: { repositoryId } }),
      prisma.video.deleteMany({ where: { repositoryId } }),
      prisma.recordingSegment.deleteMany({
        where: { recordingSession: { repositoryId } },
      }),
      prisma.recordingSession.deleteMany({ where: { repositoryId } }),
      prisma.repository.delete({ where: { id: repositoryId } }),
    ]);

    return {
      id: repositoryId,
      deleted: true,
    };
  }

  async listRepositoryMembers(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;

    const memberships = await prisma.repoMember.findMany({
      where: { repositoryId },
      orderBy: [{ role: "desc" }, { userId: "asc" }],
      select: {
        userId: true,
        role: true,
        createdAt: true,
      },
    });

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: memberships.map((membership) => membership.userId),
        },
      },
      select: {
        id: true,
        displayName: true,
        deactivated: true,
      },
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      repository: toRepositoryResponse(access.repository, access.effectiveRole),
      members: memberships.map((membership) => {
        const memberUser = userMap.get(membership.userId);
        return {
          user_id: membership.userId,
          display_name: memberUser?.displayName ?? membership.userId,
          is_active: memberUser ? !memberUser.deactivated : false,
          role: toAppRepoRole(membership.role),
          is_owner: membership.userId === access.repository.ownerId,
          created_at: membership.createdAt.toISOString(),
        };
      }),
    };
  }

  async addRepositoryMember(
    access: RepositoryAccessContext,
    input: CreateRepositoryMemberInput,
  ) {
    const repositoryId = access.repository.id;
    await this.ensureTargetUserCanBeManaged(access.repository.ownerId, input.user_id);

    await prisma.repoMember.upsert({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: input.user_id,
        },
      },
      update: {
        role: input.role,
      },
      create: {
        repositoryId,
        userId: input.user_id,
        role: input.role,
      },
    });
    await refreshRepositoryContributors(repositoryId);

    return this.listRepositoryMembers(access);
  }

  async updateRepositoryMember(
    access: RepositoryAccessContext,
    targetUserId: string,
    input: UpdateRepositoryMemberInput,
  ) {
    const repositoryId = access.repository.id;
    await this.ensureTargetUserCanBeManaged(access.repository.ownerId, targetUserId);

    const membership = await prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
      select: { userId: true },
    });

    if (!membership) {
      throw NotFound("Repository member not found.");
    }

    await prisma.repoMember.update({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
      data: {
        role: input.role,
      },
    });
    await refreshRepositoryContributors(repositoryId);

    return this.listRepositoryMembers(access);
  }

  async deleteRepositoryMember(
    access: RepositoryAccessContext,
    targetUserId: string,
  ) {
    const repositoryId = access.repository.id;
    await this.ensureTargetUserCanBeManaged(access.repository.ownerId, targetUserId);

    const membership = await prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
      select: { userId: true },
    });

    if (!membership) {
      throw NotFound("Repository member not found.");
    }

    await prisma.repoMember.delete({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
    });
    await refreshRepositoryContributors(repositoryId);

    return {
      repository_id: repositoryId,
      user_id: targetUserId,
      deleted: true,
    };
  }

  private async getVideoCountsByRepositoryId(repositoryIds: string[]): Promise<Map<string, number>> {
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

  private async getRepositoryPermanentDeleteState(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;
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
      repository: access.repository,
      activeStreamingSessionCount,
      finalizingSegmentCount,
      canDelete:
        activeStreamingSessionCount === 0 &&
        finalizingSegmentCount === 0,
    };
  }

  private async getAccessibleRepositories(
    userId: string,
    userRole: AppUserRole,
    action: RepositoryActiveAccessAction,
  ) {
    const policy = getRepositoryAccessPolicy(action);
    const accessible = await this.getAccessibleRepositoryEntries(userId, userRole, policy.minRole);
    const videoCounts = await this.getVideoCountsByRepositoryId(accessible.map((entry) => entry.record.id));

    return accessible.map((entry) =>
      toRepositorySummary(entry.record, entry.effectiveRole, videoCounts.get(entry.record.id) ?? 0),
    );
  }

  private async getAccessibleRepositoryEntries(
    userId: string,
    userRole: AppUserRole,
    minRole: AppRepoRole,
  ): Promise<AccessibleRepositoryEntry[]> {
    if (userRole === "admin") {
      const repositories = await prisma.repository.findMany({
        where: { deactivated: false },
        orderBy: [{ ownerId: "asc" }, { name: "asc" }],
        select: repositorySummarySelect,
      });

      return repositories.map((repository) =>
        ({ record: toRepositoryRecord(repository), effectiveRole: "admin" }),
      );
    }

    const membershipRoleMap = await this.getMembershipRoleMap(userId);
    const accessWhere = this.buildAccessibleRepositoryWhere(membershipRoleMap, minRole);

    const repositories = await prisma.repository.findMany({
      where: {
        AND: [
          { deactivated: false },
          accessWhere,
        ],
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });

    return repositories
      .map((repository) => this.toAccessibleRepositoryEntry(repository, membershipRoleMap, minRole))
      .filter((entry): entry is AccessibleRepositoryEntry => Boolean(entry));
  }

  private async getMembershipRoleMap(userId: string): Promise<Map<string, AppRepoRole>> {
    const memberships = await prisma.repoMember.findMany({
      where: { userId },
      select: {
        repositoryId: true,
        role: true,
      },
    });

    return new Map(memberships.map((membership) => [membership.repositoryId, toAppRepoRole(membership.role)]));
  }

  private buildAccessibleRepositoryWhere(
    membershipRoleMap: Map<string, AppRepoRole>,
    minRole: AppRepoRole,
  ): Prisma.RepositoryWhereInput {
    if (this.allowsPublicReadFallback(minRole)) {
      return {
        OR: [
          { visibility: RepoVisibility.public },
          { id: { in: Array.from(membershipRoleMap.keys()) } },
        ],
      };
    }

    return {
      id: { in: this.getRepositoryIdsWithRoleAtLeast(membershipRoleMap, minRole) },
    };
  }

  private toAccessibleRepositoryEntry(
    repository: RepositorySummaryRow,
    membershipRoleMap: Map<string, AppRepoRole>,
    minRole: AppRepoRole,
  ): AccessibleRepositoryEntry | null {
    const repositoryRecord = toRepositoryRecord(repository);
    const effectiveRole =
      membershipRoleMap.get(repository.id) ?? (repository.visibility === RepoVisibility.public ? "read" : null);

    if (!effectiveRole || !isRepoRoleAtLeast(effectiveRole, minRole)) {
      return null;
    }

    return { record: repositoryRecord, effectiveRole };
  }

  private getRepositoryIdsWithRoleAtLeast(
    membershipRoleMap: Map<string, AppRepoRole>,
    minRole: AppRepoRole,
  ): string[] {
    return Array.from(membershipRoleMap.entries())
      .filter(([, role]) => isRepoRoleAtLeast(role, minRole))
      .map(([repositoryId]) => repositoryId);
  }

  private allowsPublicReadFallback(minRole: AppRepoRole): boolean {
    return minRole === "read";
  }

  private async getDeactivatedAdminRepositories(userId: string, userRole: AppUserRole) {
    if (userRole === "admin") {
      return prisma.repository.findMany({
        where: { deactivated: true },
        orderBy: [{ ownerId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }

    const adminMemberships = await prisma.repoMember.findMany({
      where: {
        userId,
        role: RepoRole.admin,
      },
      select: { repositoryId: true },
    });

    if (adminMemberships.length === 0) {
      return [];
    }

    return prisma.repository.findMany({
      where: {
        id: { in: adminMemberships.map((membership) => membership.repositoryId) },
        deactivated: true,
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        description: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async ensureTargetUserCanBeManaged(ownerId: string, targetUserId: string) {
    if (ownerId === targetUserId) {
      throw BadRequest("Repository owner membership cannot be changed.");
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        deactivated: true,
      },
    });

    if (!targetUser) {
      throw NotFound("User not found.");
    }

    if (targetUser.deactivated) {
      throw BadRequest("Inactive users cannot be added to a repository.");
    }
  }

  private async ensureRepositoryIsIdle(
    repositoryId: string,
    _repositoryName: string,
    options: { blockPending?: boolean } = { blockPending: true },
  ) {
    const sessionStatusFilter = options.blockPending
      ? {
          in: [
            RecordingSessionStatus.PENDING,
            RecordingSessionStatus.STREAMING,
          ],
        }
      : RecordingSessionStatus.STREAMING;
    const activeSession = await prisma.recordingSession.findFirst({
      where: {
        repositoryId,
        status: sessionStatusFilter,
      },
      select: { id: true },
    });

    if (activeSession) {
      throw Conflict("Repository cannot be modified while a stream is active.");
    }

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

    if (finalizingSegment) {
      throw Conflict("Repository cannot be modified while recording finalization is in progress.");
    }
  }

  private async renameRepositoryDirectory(ownerId: string, previousName: string, nextName: string, repositoryId: string) {
    const targetDirectory = getTargetDirectory();
    const previousDirectory = path.join(targetDirectory, ownerId, previousName);
    const nextDirectory = path.join(targetDirectory, ownerId, nextName);

    if (await pathExists(nextDirectory)) {
      throw Conflict("Target repository directory already exists.");
    }

    if (await pathExists(previousDirectory)) {
      await fs.mkdir(path.dirname(nextDirectory), { recursive: true });
      await movePath(previousDirectory, nextDirectory);
    }

    const videos = await prisma.video.findMany({
      where: { repositoryId },
      select: {
        id: true,
        vlmVideoPath: true,
        dashboardVideoPath: true,
        thumbnailPath: true,
      },
    });

    await prisma.$transaction(
      videos.map((video) =>
        prisma.video.update({
          where: { id: video.id },
          data: {
            vlmVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.vlmVideoPath),
            dashboardVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.dashboardVideoPath),
            thumbnailPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.thumbnailPath),
          },
        }),
      ),
    );
  }
}

export const repositoryService = new RepositoryService();
