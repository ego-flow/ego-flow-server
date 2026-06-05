import { RepoVisibility } from "@prisma/client";

import { Forbidden, NotFound } from "../lib/errors";
import { isRepoRoleAtLeast, toAppRepoRole } from "../lib/repository-roles";
import { toRepositoryRecord } from "../mappers/repository.mapper";
import { repositoryAccessRepository } from "../repositories/repository-access.repository";
import type { AppUserRole } from "../types/auth";
import type { AppRepoRole, RepositoryAccessContext } from "../types/repository";

export class RepositoryAccessService {
  async getAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
  ): Promise<RepositoryAccessContext | null> {
    const repository = await repositoryAccessRepository.findRepositoryById(repositoryId);
    if (!repository || repository.deactivated) {
      return null;
    }

    if (userRole === "admin") {
      return {
        repository: toRepositoryRecord(repository),
        effectiveRole: "admin",
        isSystemAdmin: true,
      };
    }

    const membershipRole = await repositoryAccessRepository.findMembershipRole(repositoryId, userId);
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

  async assertAccess(
    userId: string,
    userRole: AppUserRole,
    repositoryId: string,
    minRole: AppRepoRole,
  ): Promise<RepositoryAccessContext> {
    const access = await this.getAccess(userId, userRole, repositoryId);
    if (!access) {
      const repositoryState = await repositoryAccessRepository.findRepositoryState(repositoryId);
      if (!repositoryState || repositoryState.deactivated) {
        throw NotFound("Repository not found.");
      }

      throw Forbidden("You do not have access to this repository.");
    }

    if (!isRepoRoleAtLeast(access.effectiveRole, minRole)) {
      throw Forbidden("You do not have permission for this repository action.");
    }

    return access;
  }
}

export const repositoryAccessService = new RepositoryAccessService();
