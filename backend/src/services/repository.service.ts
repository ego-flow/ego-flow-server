import fs from "fs/promises";
import path from "path";

import { Prisma, RepoRole, RepoVisibility } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { getTargetDirectory } from "../lib/storage";
import type {
  CreateRepositoryInput,
  CreateRepositoryMemberInput,
  RepositoryResolveQueryInput,
  UpdateRepositoryInput,
  UpdateRepositoryMemberInput,
} from "../schemas/repository.schema";
import type { AppUserRole } from "../types/auth";
import type { AppRepoRole, RepositoryAccessContext, RepositoryRecord } from "../types/repository";

const REPO_ROLE_RANK: Record<AppRepoRole, number> = {
  read: 1,
  maintain: 2,
  admin: 3,
};

const toAppRepoRole = (role: RepoRole): AppRepoRole => role;
const toVisibility = (visibility: RepoVisibility): "public" | "private" => visibility;

const toRepositoryRecord = (repository: {
  id: string;
  name: string;
  ownerId: string;
  visibility: RepoVisibility;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): RepositoryRecord => ({
  id: repository.id,
  name: repository.name,
  ownerId: repository.ownerId,
  visibility: toVisibility(repository.visibility),
  description: repository.description,
  createdAt: repository.createdAt,
  updatedAt: repository.updatedAt,
});

const toRepositoryResponse = (
  repository: RepositoryRecord,
  effectiveRole: AppRepoRole,
) => ({
  id: repository.id,
  name: repository.name,
  owner_id: repository.ownerId,
  visibility: repository.visibility,
  description: repository.description,
  my_role: effectiveRole,
  created_at: repository.createdAt.toISOString(),
  updated_at: repository.updatedAt.toISOString(),
});

const isRoleAtLeast = (actualRole: AppRepoRole, minimumRole: AppRepoRole): boolean =>
  REPO_ROLE_RANK[actualRole] >= REPO_ROLE_RANK[minimumRole];

const normalizeDescription = (description: string | null | undefined): string | null => {
  if (description === undefined || description === null) {
    return description ?? null;
  }

  const trimmed = description.trim();
  return trimmed ? trimmed : null;
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const movePath = async (sourcePath: string, destinationPath: string) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "EXDEV") {
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: false });
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }

    throw error;
  }
};

const remapManagedPath = (previousPath: string, nextPath: string, filePath: string | null): string | null => {
  if (!filePath) {
    return null;
  }

  const resolvedFilePath = path.resolve(filePath);
  const relative = path.relative(previousPath, resolvedFilePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }

  return path.join(nextPath, relative);
};

const isConflictError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const streamSessionKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;

export class RepositoryService {
  async getRepositoryAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
  ): Promise<RepositoryAccessContext | null> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!repository) {
      return null;
    }

    if (userRole === "admin") {
      return {
        repository: toRepositoryRecord(repository),
        effectiveRole: "admin",
        isSystemAdmin: true,
      };
    }

    const membership = await prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });

    if (membership) {
      return {
        repository: toRepositoryRecord(repository),
        effectiveRole: toAppRepoRole(membership.role),
        isSystemAdmin: false,
      };
    }

    if (repository.visibility === RepoVisibility.public) {
      return {
        repository: toRepositoryRecord(repository),
        effectiveRole: "read",
        isSystemAdmin: false,
      };
    }

    return null;
  }

  async assertRepositoryAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    minRole: AppRepoRole,
  ): Promise<RepositoryAccessContext> {
    const access = await this.getRepositoryAccess(userId, userRole, repositoryId);
    if (!access) {
      const exists = await prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { id: true },
      });

      if (!exists) {
        throw new AppError(404, "NOT_FOUND", "Repository not found.");
      }

      throw new AppError(403, "FORBIDDEN", "You do not have access to this repository.");
    }

    if (!isRoleAtLeast(access.effectiveRole, minRole)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission for this repository action.");
    }

    return access;
  }

  async assertRepositoryAccessByOwnerAndName(
    userId: string,
    userRole: AppUserRole,
    ownerId: string,
    repoName: string,
    minRole: AppRepoRole,
  ): Promise<RepositoryAccessContext> {
    const repository = await prisma.repository.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name: repoName,
        },
      },
      select: { id: true },
    });

    if (!repository) {
      throw new AppError(404, "NOT_FOUND", "Repository not found.");
    }

    return this.assertRepositoryAccess(userId, userRole, repository.id, minRole);
  }

  async listAccessibleRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await this.getAccessibleRepositories(userId, userRole),
    };
  }

  async listMaintainedRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await this.getAccessibleRepositories(userId, userRole, "maintain"),
    };
  }

  async getRepositoryDetail(userId: string, userRole: AppUserRole, repositoryId: string) {
    const access = await this.assertRepositoryAccess(userId, userRole, repositoryId, "read");
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
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!repository) {
      throw new AppError(404, "NOT_FOUND", "Repository not found.");
    }

    const access = await this.getRepositoryAccess(requestUserId, requestUserRole, repository.id);
    if (!access) {
      throw new AppError(404, "NOT_FOUND", "Repository not found.");
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
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
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
        throw new AppError(409, "CONFLICT", "Repository name already exists for this owner.");
      }

      throw error;
    }
  }

  async updateRepository(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    input: UpdateRepositoryInput,
  ) {
    const access = await this.assertRepositoryAccess(userId, userRole, repositoryId, "admin");
    const previousRepository = access.repository;
    const nextName = input.name ?? previousRepository.name;
    const nextVisibility = input.visibility ?? previousRepository.visibility;
    const nextDescription =
      input.description === undefined ? previousRepository.description : normalizeDescription(input.description);

    if (
      nextName === previousRepository.name &&
      nextVisibility === previousRepository.visibility &&
      nextDescription === previousRepository.description
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
        },
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
      };
    } catch (error) {
      if (isConflictError(error)) {
        throw new AppError(409, "CONFLICT", "Repository name already exists for this owner.");
      }

      throw error;
    }
  }

  async deleteRepository(userId: string, userRole: AppUserRole, repositoryId: string) {
    const access = await this.assertRepositoryAccess(userId, userRole, repositoryId, "admin");
    await this.ensureRepositoryIsIdle(access.repository.id, access.repository.name);

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
      prisma.repository.delete({ where: { id: repositoryId } }),
    ]);

    return {
      id: repositoryId,
      deleted: true,
    };
  }

  async listRepositoryMembers(userId: string, userRole: AppUserRole, repositoryId: string) {
    const access = await this.assertRepositoryAccess(userId, userRole, repositoryId, "admin");

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
        isActive: true,
      },
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      repository: toRepositoryResponse(access.repository, access.effectiveRole),
      members: memberships.map((membership) => {
        const memberUser = userMap.get(membership.userId);
        return {
          user_id: membership.userId,
          display_name: memberUser?.displayName ?? null,
          is_active: memberUser?.isActive ?? false,
          role: toAppRepoRole(membership.role),
          is_owner: membership.userId === access.repository.ownerId,
          created_at: membership.createdAt.toISOString(),
        };
      }),
    };
  }

  async addRepositoryMember(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    input: CreateRepositoryMemberInput,
  ) {
    const access = await this.assertRepositoryAccess(userId, userRole, repositoryId, "admin");
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

    return this.listRepositoryMembers(userId, userRole, repositoryId);
  }

  async updateRepositoryMember(
    requestUserId: string,
    requestUserRole: AppUserRole,
    repositoryId: string,
    targetUserId: string,
    input: UpdateRepositoryMemberInput,
  ) {
    const access = await this.assertRepositoryAccess(requestUserId, requestUserRole, repositoryId, "admin");
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
      throw new AppError(404, "NOT_FOUND", "Repository member not found.");
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

    return this.listRepositoryMembers(requestUserId, requestUserRole, repositoryId);
  }

  async deleteRepositoryMember(
    requestUserId: string,
    requestUserRole: AppUserRole,
    repositoryId: string,
    targetUserId: string,
  ) {
    const access = await this.assertRepositoryAccess(requestUserId, requestUserRole, repositoryId, "admin");
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
      throw new AppError(404, "NOT_FOUND", "Repository member not found.");
    }

    await prisma.repoMember.delete({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId: targetUserId,
        },
      },
    });

    return {
      repository_id: repositoryId,
      user_id: targetUserId,
      deleted: true,
    };
  }

  private async getAccessibleRepositories(userId: string, userRole: AppUserRole, minRole: AppRepoRole = "read") {
    if (userRole === "admin") {
      const repositories = await prisma.repository.findMany({
        orderBy: [{ ownerId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          ownerId: true,
          visibility: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return repositories.map((repository) => toRepositoryResponse(toRepositoryRecord(repository), "admin"));
    }

    const memberships = await prisma.repoMember.findMany({
      where: { userId },
      select: {
        repositoryId: true,
        role: true,
      },
    });

    const membershipRoleMap = new Map(memberships.map((membership) => [membership.repositoryId, toAppRepoRole(membership.role)]));
    const memberRepoIds = memberships
      .filter((membership) => isRoleAtLeast(toAppRepoRole(membership.role), minRole))
      .map((membership) => membership.repositoryId);

    const where =
      minRole === "read"
        ? {
            OR: [
              { visibility: RepoVisibility.public },
              { id: { in: Array.from(membershipRoleMap.keys()) } },
            ],
          }
        : {
            id: { in: memberRepoIds },
          };

    const repositories = await prisma.repository.findMany({
      where,
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return repositories
      .map((repository) => {
        const repositoryRecord = toRepositoryRecord(repository);
        const effectiveRole = membershipRoleMap.get(repository.id) ?? (repository.visibility === RepoVisibility.public ? "read" : null);
        if (!effectiveRole || !isRoleAtLeast(effectiveRole, minRole)) {
          return null;
        }

        return toRepositoryResponse(repositoryRecord, effectiveRole);
      })
      .filter((repository): repository is ReturnType<typeof toRepositoryResponse> => Boolean(repository));
  }

  private async ensureTargetUserCanBeManaged(ownerId: string, targetUserId: string) {
    if (ownerId === targetUserId) {
      throw new AppError(400, "VALIDATION_ERROR", "Repository owner membership cannot be changed.");
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!targetUser) {
      throw new AppError(404, "NOT_FOUND", "User not found.");
    }

    if (!targetUser.isActive) {
      throw new AppError(400, "VALIDATION_ERROR", "Inactive users cannot be added to a repository.");
    }
  }

  private async ensureRepositoryIsIdle(repositoryId: string, repositoryName: string) {
    const [sessionById, sessionByPath] = await Promise.all([
      redis.get(streamSessionKey(repositoryId)),
      redis.get(streamPathKey(repositoryName)),
    ]);

    if (sessionById || sessionByPath) {
      throw new AppError(409, "CONFLICT", "Repository cannot be modified while a stream is active.");
    }
  }

  private async renameRepositoryDirectory(ownerId: string, previousName: string, nextName: string, repositoryId: string) {
    const targetDirectory = getTargetDirectory();
    const previousDirectory = path.join(targetDirectory, ownerId, previousName);
    const nextDirectory = path.join(targetDirectory, ownerId, nextName);

    if (await pathExists(nextDirectory)) {
      throw new AppError(409, "CONFLICT", "Target repository directory already exists.");
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
            vlmVideoPath: remapManagedPath(previousDirectory, nextDirectory, video.vlmVideoPath),
            dashboardVideoPath: remapManagedPath(previousDirectory, nextDirectory, video.dashboardVideoPath),
            thumbnailPath: remapManagedPath(previousDirectory, nextDirectory, video.thumbnailPath),
          },
        }),
      ),
    );
  }
}

export const repositoryService = new RepositoryService();
