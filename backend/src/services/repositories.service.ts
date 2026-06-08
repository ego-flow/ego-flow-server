import { loadRepositoryManifest } from "../lib/repositories/repository-manifest";
import {
  createRepository as createRepositoryUseCase,
  deactivateRepository as deactivateRepositoryUseCase,
  getRepositoryDeleteReadiness as getRepositoryDeleteReadinessUseCase,
  permanentlyDeleteRepository as permanentlyDeleteRepositoryUseCase,
  updateRepository as updateRepositoryUseCase,
} from "../lib/repositories/repository-lifecycle";
import { getRepositoryResolveTarget } from "../lib/repositories/repository-input";
import {
  addRepositoryMember as addRepositoryMemberUseCase,
  deleteRepositoryMember as deleteRepositoryMemberUseCase,
  listRepositoryMembers as listRepositoryMembersUseCase,
  updateRepositoryMember as updateRepositoryMemberUseCase,
} from "../lib/repositories/repository-members";
import {
  listAccessibleRepositorySummaries,
  listDeactivatedAdminRepositorySummaries,
} from "../lib/repositories/repository-listing";
import { resolveRepositoryByOwnerAndName } from "../lib/repositories/repository-resolve";
import { toRepositoryResponse } from "../mappers/repository.mapper";
import type {
  CreateRepositoryInput,
  CreateRepositoryMemberInput,
  ManifestQueryInput,
  RepositoryResolveQueryInput,
  UpdateRepositoryInput,
  UpdateRepositoryMemberInput,
} from "../types/repository/request";
import type { AppUserRole } from "../types/auth";
import type { RepositoryAccessContext } from "../types/repository";

export class RepositoriesService {
  async listAccessibleRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await listAccessibleRepositorySummaries(userId, userRole, "repository.list"),
    };
  }

  async listMaintainedRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await listAccessibleRepositorySummaries(userId, userRole, "repository.listMaintained"),
    };
  }

  async listDeactivatedAdminRepositories(userId: string, userRole: AppUserRole) {
    return {
      repositories: await listDeactivatedAdminRepositorySummaries(userId, userRole),
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
    const { ownerId, repoName } = getRepositoryResolveTarget(query);
    return this.resolveRepository(requestUserId, requestUserRole, ownerId, repoName);
  }

  async resolveRepository(
    requestUserId: string,
    requestUserRole: AppUserRole,
    ownerId: string,
    repoName: string,
  ) {
    return resolveRepositoryByOwnerAndName(requestUserId, requestUserRole, ownerId, repoName);
  }

  async createRepository(userId: string, input: CreateRepositoryInput) {
    return createRepositoryUseCase(userId, input);
  }

  async updateRepository(
    access: RepositoryAccessContext,
    input: UpdateRepositoryInput,
  ) {
    return updateRepositoryUseCase(access, input);
  }

  async deactivateRepository(access: RepositoryAccessContext) {
    return deactivateRepositoryUseCase(access);
  }

  async getRepositoryDeleteReadiness(access: RepositoryAccessContext) {
    return getRepositoryDeleteReadinessUseCase(access);
  }

  async permanentlyDeleteRepository(access: RepositoryAccessContext) {
    return permanentlyDeleteRepositoryUseCase(access);
  }

  async listRepositoryMembers(access: RepositoryAccessContext) {
    return listRepositoryMembersUseCase(access);
  }

  async addRepositoryMember(
    access: RepositoryAccessContext,
    input: CreateRepositoryMemberInput,
  ) {
    return addRepositoryMemberUseCase(access, input);
  }

  async updateRepositoryMember(
    access: RepositoryAccessContext,
    targetUserId: string,
    input: UpdateRepositoryMemberInput,
  ) {
    return updateRepositoryMemberUseCase(access, targetUserId, input);
  }

  async deleteRepositoryMember(
    access: RepositoryAccessContext,
    targetUserId: string,
  ) {
    return deleteRepositoryMemberUseCase(access, targetUserId);
  }
}

export const repositoriesService = new RepositoriesService();
