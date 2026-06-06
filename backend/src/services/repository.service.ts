import fs from "fs/promises";
import path from "path";

import { RepoVisibility } from "@prisma/client";

import { BadRequest, Conflict, ErrorCode, NotFound } from "../lib/core/errors";
import { getRepositoryAccessPolicy, type RepositoryActiveAccessAction } from "../lib/repositories/access-policy";
import { isRepoRoleAtLeast, toAppRepoRole } from "../lib/repositories/roles";
import { runPrismaTransaction } from "../lib/infra/prisma";
import { getTargetDirectory } from "../lib/storage/storage";
import { normalizeRepositoryTags, toRepositoryRecord } from "../mappers/repository.mapper";
import {
  isUniqueConstraintError,
  repositoriesRepository,
  type RepositorySummaryRow,
} from "../repositories/repositories.repository";
import { repoMemberRepository } from "../repositories/repo-member.repository";
import { recordingSegmentRepository } from "../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import { userRepository } from "../repositories/user.repository";
import { videosRepository } from "../repositories/videos.repository";
import type {
  CreateRepositoryInput,
  CreateRepositoryMemberInput,
  ManifestQueryInput,
  RepositoryResolveQueryInput,
  UpdateRepositoryInput,
  UpdateRepositoryMemberInput,
} from "../schemas/repository.schema";
import type { AppUserRole } from "../types/auth";
import type { AppRepoRole, RepositoryAccessContext, RepositoryRecord } from "../types/repository";
import { movePath, pathExists } from "../lib/storage/file-system";
import { remapPathWithinDirectory } from "../lib/storage/path-mapping";
import { repositoryAccessService } from "../lib/repositories/repository-access";
import { refreshRepositoryContributors } from "../lib/repositories/repository-contributors";

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
      return new Set(await repositoriesRepository.findActiveRepositoryIds());
    }

    const membershipRoleMap = await this.getMembershipRoleMap(userId);
    const memberRepoIds = this.getRepositoryIdsWithRoleAtLeast(membershipRoleMap, policy.minRole);

    const [memberRepos, publicRepos] = await Promise.all([
      repositoriesRepository.findActiveRepositoryIdsByIds(memberRepoIds),
      this.allowsPublicReadFallback(policy.minRole)
        ? repositoriesRepository.findActivePublicRepositoryIds()
        : Promise.resolve([]),
    ]);

    const accessible = new Set<string>();
    for (const repositoryId of memberRepos) {
      accessible.add(repositoryId);
    }
    for (const repositoryId of publicRepos) {
      accessible.add(repositoryId);
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

  async resolveRepositoryFromQuery(
    requestUserId: string,
    requestUserRole: AppUserRole,
    query: RepositoryResolveQueryInput,
  ) {
    const { ownerId, repoName } = this.getRepositoryResolveTarget(query);
    return this.resolveRepository(requestUserId, requestUserRole, ownerId, repoName);
  }

  async resolveRepository(
    requestUserId: string,
    requestUserRole: AppUserRole,
    ownerId: string,
    repoName: string,
  ) {
    const repository = await repositoriesRepository.findRepositoryByOwnerAndName(ownerId, repoName);

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

  async getRepositoryManifest(access: RepositoryAccessContext, query: ManifestQueryInput) {
    const { videosService } = await import("./videos.service");
    return videosService.getRepositoryManifest(
      access.repository.id,
      access.repository,
      access.effectiveRole,
      query,
    );
  }

  async createRepository(userId: string, input: CreateRepositoryInput) {
    try {
      const repository = await repositoriesRepository.createRepository({
        name: input.name,
        ownerId: userId,
        visibility: input.visibility,
        description: normalizeDescription(input.description),
        tags: normalizeRepositoryTags(input.tags),
        contributors: [userId],
      });

      await repoMemberRepository.createAdminMember(repository.id, userId);

      return {
        repository: toRepositoryResponse(toRepositoryRecord(repository), "admin"),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
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
      const repository = await repositoriesRepository.updateRepository({
        repositoryId,
        name: nextName,
        visibility: nextVisibility === "public" ? RepoVisibility.public : RepoVisibility.private,
        description: nextDescription,
        tags: nextTags,
      });

      return {
        repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw Conflict("Repository name already exists for this owner.");
      }

      throw error;
    }
  }

  async deactivateRepository(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;

    await repositoriesRepository.markRepositoryDeactivated(repositoryId);

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

    const videos = await videosRepository.findRepositoryVideoPaths(repositoryId);

    await Promise.all(
      videos.flatMap((video) =>
        [video.rawRecordingPath, video.vlmVideoPath, video.dashboardVideoPath, video.thumbnailPath]
          .filter((filePath): filePath is string => Boolean(filePath))
          .map((filePath) => fs.rm(filePath, { force: true, recursive: true })),
      ),
    );

    const repositoryDir = path.join(getTargetDirectory(), access.repository.ownerId, access.repository.name);
    await fs.rm(repositoryDir, { recursive: true, force: true });

    await runPrismaTransaction(async (tx) => {
      await repoMemberRepository.deleteManyByRepositoryId(repositoryId, tx);
      await videosRepository.deleteManyByRepositoryId(repositoryId, tx);
      await recordingSegmentRepository.deleteManyByRepositoryId(repositoryId, tx);
      await recordingSessionRepository.deleteManyByRepositoryId(repositoryId, tx);
      await repositoriesRepository.deleteRepository(repositoryId, tx);
    });

    return {
      id: repositoryId,
      deleted: true,
    };
  }

  async listRepositoryMembers(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;

    const memberships = await repoMemberRepository.findRepositoryMembers(repositoryId);
    const users = await userRepository.findSummaries(memberships.map((membership) => membership.userId));

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

    await repoMemberRepository.upsertRepositoryMember({
      repositoryId,
      userId: input.user_id,
      role: input.role,
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

    const membership = await repoMemberRepository.findRepositoryMembership(repositoryId, targetUserId);

    if (!membership) {
      throw NotFound("Repository member not found.");
    }

    await repoMemberRepository.updateRepositoryMemberRole({
      repositoryId,
      userId: targetUserId,
      role: input.role,
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

    const membership = await repoMemberRepository.findRepositoryMembership(repositoryId, targetUserId);

    if (!membership) {
      throw NotFound("Repository member not found.");
    }

    await repoMemberRepository.deleteRepositoryMember(repositoryId, targetUserId);
    await refreshRepositoryContributors(repositoryId);

    return {
      repository_id: repositoryId,
      user_id: targetUserId,
      deleted: true,
    };
  }

  private async getVideoCountsByRepositoryId(repositoryIds: string[]): Promise<Map<string, number>> {
    return videosRepository.countVideosByRepositoryIds(repositoryIds);
  }

  private async getRepositoryPermanentDeleteState(access: RepositoryAccessContext) {
    const repositoryId = access.repository.id;
    const [activeStreamingSessionCount, finalizingSegmentCount] = await Promise.all([
      recordingSessionRepository.countStreamingByRepositoryId(repositoryId),
      recordingSegmentRepository.countFinalizingByRepositoryId(repositoryId),
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
      const repositories = await repositoriesRepository.findActiveRepositorySummaries();

      return repositories.map((repository) =>
        ({ record: toRepositoryRecord(repository), effectiveRole: "admin" }),
      );
    }

    const membershipRoleMap = await this.getMembershipRoleMap(userId);
    const repositories = await repositoriesRepository.findActiveRepositorySummariesForAccess({
      memberRepositoryIds: this.getRepositoryIdsWithRoleAtLeast(membershipRoleMap, minRole),
      includePublic: this.allowsPublicReadFallback(minRole),
    });

    return repositories
      .map((repository) => this.toAccessibleRepositoryEntry(repository, membershipRoleMap, minRole))
      .filter((entry): entry is AccessibleRepositoryEntry => Boolean(entry));
  }

  private async getMembershipRoleMap(userId: string): Promise<Map<string, AppRepoRole>> {
    const memberships = await repoMemberRepository.findMembershipRolesByUser(userId);

    return new Map(memberships.map((membership) => [membership.repositoryId, toAppRepoRole(membership.role)]));
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
      return repositoriesRepository.findDeactivatedRepositorySummariesForSystemAdmin();
    }

    const adminRepositoryIds = await repoMemberRepository.findAdminRepositoryIdsByUser(userId);

    if (adminRepositoryIds.length === 0) {
      return [];
    }

    return repositoriesRepository.findDeactivatedRepositorySummariesByIds(adminRepositoryIds);
  }

  private async ensureTargetUserCanBeManaged(ownerId: string, targetUserId: string) {
    if (ownerId === targetUserId) {
      throw BadRequest("Repository owner membership cannot be changed.");
    }

    const targetUser = await userRepository.findActiveState(targetUserId);

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
    const activeSession = await recordingSessionRepository.hasOpenSessionByRepositoryId({
      repositoryId,
      blockPending: options.blockPending ?? true,
    });

    if (activeSession) {
      throw Conflict("Repository cannot be modified while a stream is active.");
    }

    const finalizingSegment = await recordingSegmentRepository.hasFinalizingByRepositoryId(repositoryId);

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

    const videos = await videosRepository.findVideoPathsForRepositoryRename(repositoryId);

    await videosRepository.updateVideoPathsForRepositoryRename({
      videos: videos.map((video) => ({
        id: video.id,
        vlmVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.vlmVideoPath),
        dashboardVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.dashboardVideoPath),
        thumbnailPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.thumbnailPath),
      })),
    });
  }

  private getRepositoryResolveTarget(query: RepositoryResolveQueryInput) {
    if (query.slug) {
      const parts = query.slug.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw BadRequest("Slug must be in 'owner/name' format.", ErrorCode.INVALID_SLUG);
      }

      return {
        ownerId: parts[0],
        repoName: parts[1],
      };
    }

    return {
      ownerId: query.owner_id!,
      repoName: query.name!,
    };
  }
}

export const repositoryService = new RepositoryService();
