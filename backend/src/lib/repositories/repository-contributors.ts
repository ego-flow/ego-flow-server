import { type Prisma } from "@prisma/client";

import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { repositoriesRepository } from "../../repositories/repositories.repository";
import {
  defaultRepositoryPersistenceClient,
  isRootRepositoryPersistenceClient,
  runRepositoryTransaction,
  type RepositoryPersistenceClient,
} from "../../repositories/repository-transaction";
import { videosRepository } from "../../repositories/videos.repository";

export const normalizeContributorUserIds = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))).sort();
};

export const computeRepositoryContributorUserIds = async (
  repositoryId: string,
  client: RepositoryPersistenceClient = defaultRepositoryPersistenceClient,
): Promise<string[]> => {
  const [contributors, adminUserIds, recorderUserIds] = await Promise.all([
    repositoriesRepository.findContributors(repositoryId, client),
    repoMemberRepository.findAdminUserIdsByRepository(repositoryId, client),
    videosRepository.findRecorderUserIdsByRepository(repositoryId, client),
  ]);

  return Array.from(
    new Set([
      ...normalizeContributorUserIds(contributors),
      ...adminUserIds,
      ...recorderUserIds,
    ]),
  ).sort();
};

export const refreshRepositoryContributors = async (
  repositoryId: string,
  client: RepositoryPersistenceClient = defaultRepositoryPersistenceClient,
): Promise<string[]> => {
  if (isRootRepositoryPersistenceClient(client)) {
    return runRepositoryTransaction((tx): Promise<string[]> => refreshRepositoryContributors(repositoryId, tx));
  }

  const contributorsJson = await repositoriesRepository.findContributorsForUpdate(repositoryId, client);
  const [adminUserIds, recorderUserIds] = await Promise.all([
    repoMemberRepository.findAdminUserIdsByRepository(repositoryId, client),
    videosRepository.findRecorderUserIdsByRepository(repositoryId, client),
  ]);
  const contributors = Array.from(
    new Set([
      ...normalizeContributorUserIds(contributorsJson),
      ...adminUserIds,
      ...recorderUserIds,
    ]),
  ).sort();

  await repositoriesRepository.updateContributors(repositoryId, contributors, client);

  return contributors;
};
