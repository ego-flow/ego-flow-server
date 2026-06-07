import { RepoVisibility } from "@prisma/client";

import { BadRequest, Conflict, ErrorCode, NotFound } from "../lib/core/errors";
import { getRepositoryAccessPolicy, type RepositoryActiveAccessAction } from "../lib/repositories/access-policy";
import { permanentlyDeleteRepositoryData } from "../lib/repositories/repository-delete";
import { renameRepositoryDirectory } from "../lib/repositories/repository-directory";
import { loadRepositoryManifest } from "../lib/repositories/repository-manifest";
import {
  assertRepositoryIsIdle,
  assertRepositoryPermanentlyDeletable,
  getRepositoryPermanentDeleteState,
} from "../lib/repositories/repository-work-state";
import { isRepoRoleAtLeast, toAppRepoRole } from "../lib/repositories/roles";
import {
  normalizeRepositoryTags,
  toRepositoryRecord,
  toRepositoryResponse,
  toRepositorySummary,
} from "../mappers/repository.mapper";
import {
  isUniqueConstraintError,
  repositoriesRepository,
  type RepositorySummaryRow,
} from "../repositories/repositories.repository";
import { repoMemberRepository } from "../repositories/repo-member.repository";
import { userRepository } from "../repositories/user.repository";
import { videosRepository } from "../repositories/videos.repository";
import type {
  CreateRepositoryInput,
  CreateRepositoryMemberInput,
  ManifestQueryInput,
  RepositoryResolveQueryInput,
  UpdateRepositoryInput,
  UpdateRepositoryMemberInput,
} from "../types/repository/request";
import type { AppUserRole } from "../types/auth";
import type { AppRepoRole, RepositoryAccessContext, RepositoryRecord } from "../types/repository";
import { repositoryAccessService } from "../lib/repositories/repository-access";
import { refreshRepositoryContributors } from "../lib/repositories/repository-contributors";

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

export class RepositoriesService {
  async listAccessibleRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await this.getAccessibleRepositories(userId, userRole, "repository.list"),
    };
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

  async getRepositoryManifest(access: RepositoryAccessContext, query: ManifestQueryInput) {
    return loadRepositoryManifest(access, query);
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
      await assertRepositoryIsIdle(previousRepository.id);
      await renameRepositoryDirectory({
        ownerId: previousRepository.ownerId,
        previousName: previousRepository.name,
        nextName,
        repositoryId,
      });
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
    const state = await getRepositoryPermanentDeleteState(access.repository.id);

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
    const state = await getRepositoryPermanentDeleteState(access.repository.id);
    const repositoryId = access.repository.id;

    assertRepositoryPermanentlyDeletable(state);
    await permanentlyDeleteRepositoryData(access.repository);

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

export const repositoriesService = new RepositoriesService();
