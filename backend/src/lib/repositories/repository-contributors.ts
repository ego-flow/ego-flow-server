import { type Prisma } from "@prisma/client";

import { prisma, runPrismaTransaction, type PrismaTransactionClient } from "../infra/prisma";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { repositoriesRepository } from "../../repositories/repositories.repository";
import { videosRepository } from "../../repositories/videos.repository";

type PrismaClientLike = typeof prisma | PrismaTransactionClient;

const isRootPrismaClient = (client: PrismaClientLike): client is typeof prisma =>
  typeof (client as typeof prisma).$transaction === "function" &&
  typeof (client as typeof prisma).$connect === "function";

export const normalizeContributorUserIds = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))).sort();
};

export const computeRepositoryContributorUserIds = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
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
  client: PrismaClientLike = prisma,
): Promise<string[]> => {
  if (isRootPrismaClient(client)) {
    return runPrismaTransaction((tx): Promise<string[]> => refreshRepositoryContributors(repositoryId, tx));
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
