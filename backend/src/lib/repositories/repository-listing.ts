import { RepoVisibility } from "@prisma/client";

import { toRepositoryRecord, toRepositorySummary } from "../../mappers/repository.mapper";
import {
  repositoriesRepository,
  type RepositorySummaryRow,
} from "../../repositories/repositories.repository";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { videosRepository } from "../../repositories/videos.repository";
import type { AppUserRole } from "../../types/auth";
import type { AppRepoRole, RepositoryRecord } from "../../types/repository";
import type { RepositorySummaryResponse } from "../../types/repository/response";
import { getRepositoryAccessPolicy, type RepositoryActiveAccessAction } from "./access-policy";
import { isRepoRoleAtLeast, toAppRepoRole } from "./roles";

type AccessibleRepositoryEntry = {
  record: RepositoryRecord;
  effectiveRole: AppRepoRole;
};

const getVideoCountsByRepositoryId = (repositoryIds: string[]): Promise<Map<string, number>> =>
  videosRepository.countVideosByRepositoryIds(repositoryIds);

const getMembershipRoleMap = async (userId: string): Promise<Map<string, AppRepoRole>> => {
  const memberships = await repoMemberRepository.findMembershipRolesByUser(userId);

  return new Map(memberships.map((membership) => [membership.repositoryId, toAppRepoRole(membership.role)]));
};

const getRepositoryIdsWithRoleAtLeast = (
  membershipRoleMap: Map<string, AppRepoRole>,
  minRole: AppRepoRole,
): string[] =>
  Array.from(membershipRoleMap.entries())
    .filter(([, role]) => isRepoRoleAtLeast(role, minRole))
    .map(([repositoryId]) => repositoryId);

const allowsPublicReadFallback = (minRole: AppRepoRole): boolean => minRole === "read";

const toAccessibleRepositoryEntry = (
  repository: RepositorySummaryRow,
  membershipRoleMap: Map<string, AppRepoRole>,
  minRole: AppRepoRole,
): AccessibleRepositoryEntry | null => {
  const repositoryRecord = toRepositoryRecord(repository);
  const effectiveRole =
    membershipRoleMap.get(repository.id) ?? (repository.visibility === RepoVisibility.public ? "read" : null);

  if (!effectiveRole || !isRepoRoleAtLeast(effectiveRole, minRole)) {
    return null;
  }

  return { record: repositoryRecord, effectiveRole };
};

const getAccessibleRepositoryEntries = async (
  userId: string,
  userRole: AppUserRole,
  minRole: AppRepoRole,
): Promise<AccessibleRepositoryEntry[]> => {
  if (userRole === "admin") {
    const repositories = await repositoriesRepository.findActiveRepositorySummaries();

    return repositories.map((repository) => ({ record: toRepositoryRecord(repository), effectiveRole: "admin" }));
  }

  const membershipRoleMap = await getMembershipRoleMap(userId);
  const repositories = await repositoriesRepository.findActiveRepositorySummariesForAccess({
    memberRepositoryIds: getRepositoryIdsWithRoleAtLeast(membershipRoleMap, minRole),
    includePublic: allowsPublicReadFallback(minRole),
  });

  return repositories
    .map((repository) => toAccessibleRepositoryEntry(repository, membershipRoleMap, minRole))
    .filter((entry): entry is AccessibleRepositoryEntry => Boolean(entry));
};

const getDeactivatedAdminRepositories = async (
  userId: string,
  userRole: AppUserRole,
): Promise<RepositorySummaryRow[]> => {
  if (userRole === "admin") {
    return repositoriesRepository.findDeactivatedRepositorySummariesForSystemAdmin();
  }

  const adminRepositoryIds = await repoMemberRepository.findAdminRepositoryIdsByUser(userId);

  if (adminRepositoryIds.length === 0) {
    return [];
  }

  return repositoriesRepository.findDeactivatedRepositorySummariesByIds(adminRepositoryIds);
};

export const listAccessibleRepositorySummaries = async (
  userId: string,
  userRole: AppUserRole,
  action: RepositoryActiveAccessAction,
): Promise<RepositorySummaryResponse[]> => {
  const policy = getRepositoryAccessPolicy(action);
  const accessible = await getAccessibleRepositoryEntries(userId, userRole, policy.minRole);
  const videoCounts = await getVideoCountsByRepositoryId(accessible.map((entry) => entry.record.id));

  return accessible.map((entry) =>
    toRepositorySummary(entry.record, entry.effectiveRole, videoCounts.get(entry.record.id) ?? 0),
  );
};

export const listDeactivatedAdminRepositorySummaries = async (
  userId: string,
  userRole: AppUserRole,
): Promise<RepositorySummaryResponse[]> => {
  const repositories = await getDeactivatedAdminRepositories(userId, userRole);
  const videoCounts = await getVideoCountsByRepositoryId(repositories.map((repository) => repository.id));

  return repositories.map((repository) =>
    toRepositorySummary(toRepositoryRecord(repository), "admin", videoCounts.get(repository.id) ?? 0),
  );
};
