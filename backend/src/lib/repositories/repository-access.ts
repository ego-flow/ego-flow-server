import { RepoVisibility } from "@prisma/client";

import { BadRequest, Forbidden, NotFound } from "../core/errors";
import {
  getRepositoryAccessPolicy,
  type RepositoryActiveAccessAction,
  type RepositoryAccessAction,
} from "./access-policy";
import { isRepoRoleAtLeast, toAppRepoRole } from "./roles";
import { toRepositoryRecord } from "../../mappers/repository.mapper";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { repositoriesRepository } from "../../repositories/repositories.repository";
import type { AppUserRole } from "../../types/auth";
import type { AppRepoRole, RepositoryAccessContext } from "../../types/repository";

export type RepositoryStatusRequirement = "active" | "deactivated";

export class RepositoryAccessService {
  private async getAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
  ): Promise<RepositoryAccessContext | null> {
    const repository = await repositoriesRepository.findRepositoryById(repositoryId);
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

    const membershipRole = await repoMemberRepository.findMembershipRole(repositoryId, userId);
    if (membershipRole) {
      return {
        repository: toRepositoryRecord(repository),
        effectiveRole: toAppRepoRole(membershipRole),
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

  private async assertAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    minRole: AppRepoRole,
  ): Promise<RepositoryAccessContext> {
    const access = await this.getAccess(userId, userRole, repositoryId);
    if (!access) {
      const repositoryPresence = await repositoriesRepository.findRepositoryState(repositoryId);
      if (!repositoryPresence) {
        throw NotFound("Repository not found.");
      }

      throw Forbidden("You do not have access to this repository.");
    }

    if (!isRepoRoleAtLeast(access.effectiveRole, minRole)) {
      throw Forbidden("You do not have permission for this repository action.");
    }

    return access;
  }

  async getAccessForAction(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    action: RepositoryActiveAccessAction,
  ): Promise<RepositoryAccessContext | null> {
    const policy = getRepositoryAccessPolicy(action);
    const access = await this.getAccess(userId, userRole, repositoryId);
    if (!access || !isRepoRoleAtLeast(access.effectiveRole, policy.minRole)) {
      return null;
    }

    return access;
  }

  async listAccessibleActiveRepositoryIds(
    userId: string,
    userRole: AppUserRole,
    action: RepositoryActiveAccessAction,
  ): Promise<Set<string>> {
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

    return new Set([...memberRepos, ...publicRepos]);
  }

  async assertAction(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    action: RepositoryAccessAction,
  ): Promise<RepositoryAccessContext> {
    const policy = getRepositoryAccessPolicy(action);
    return this.assertAccess(userId, userRole, repositoryId, policy.minRole);
  }

  async assertRepositoryStatus(
    repositoryId: string,
    required: RepositoryStatusRequirement,
  ): Promise<{ id: string; deactivated: boolean }> {
    const repositoryPresence = await repositoriesRepository.findRepositoryState(repositoryId);
    if (!repositoryPresence) {
      throw NotFound("Repository not found.");
    }

    if (required === "active" && repositoryPresence.deactivated) {
      throw NotFound("Repository not found.");
    }

    if (required === "deactivated" && !repositoryPresence.deactivated) {
      throw BadRequest("Deactivate the repository before permanent deletion.");
    }

    return repositoryPresence;
  }

  private async getMembershipRoleMap(userId: string): Promise<Map<string, AppRepoRole>> {
    const memberships = await repoMemberRepository.findMembershipRolesByUser(userId);

    return new Map(memberships.map((membership) => [membership.repositoryId, toAppRepoRole(membership.role)]));
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
}

export const repositoryAccessService = new RepositoryAccessService();
