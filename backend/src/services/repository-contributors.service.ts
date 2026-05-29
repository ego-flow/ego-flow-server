import { Prisma, RepoRole } from "@prisma/client";

import { prisma } from "../lib/prisma";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

type RepositoryContributorState = {
  contributorUserIds: string[];
  videoContributorUserIds: string[];
};

export const normalizeContributorUserIds = (value: Prisma.JsonValue | null | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))).sort();
};

export const computeRepositoryContributorState = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
): Promise<RepositoryContributorState> => {
  const [repository, memberships, videos] = await Promise.all([
    client.repository.findUnique({
      where: { id: repositoryId },
      select: {
        videoContributorUserIds: true,
      },
    }),
    client.repoMember.findMany({
      where: {
        repositoryId,
        role: { in: [RepoRole.admin, RepoRole.maintain] },
      },
      select: {
        userId: true,
        role: true,
      },
    }),
    client.video.findMany({
      where: {
        repositoryId,
        recorderUserId: {
          not: null,
        },
      },
      select: {
        recorderUserId: true,
      },
    }),
  ]);
  const videoContributorUserIds = Array.from(
    new Set([
      ...normalizeContributorUserIds(repository?.videoContributorUserIds),
      ...videos.map((video) => video.recorderUserId).filter((userId): userId is string => Boolean(userId)),
    ]),
  ).sort();
  const videoContributorUserIdSet = new Set(videoContributorUserIds);

  const adminUserIds = memberships
    .filter((membership) => membership.role === RepoRole.admin)
    .map((membership) => membership.userId);
  const maintainerUserIds = memberships
    .filter((membership) => membership.role === RepoRole.maintain)
    .map((membership) => membership.userId);
  const maintainerContributorUserIds = maintainerUserIds.filter((userId) => videoContributorUserIdSet.has(userId));

  return {
    contributorUserIds: Array.from(new Set([...adminUserIds, ...maintainerContributorUserIds])).sort(),
    videoContributorUserIds,
  };
};

export const computeRepositoryContributorUserIds = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
): Promise<string[]> => {
  const contributorState = await computeRepositoryContributorState(repositoryId, client);
  return contributorState.contributorUserIds;
};

export const refreshRepositoryContributors = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
) => {
  const contributorState = await computeRepositoryContributorState(repositoryId, client);

  await client.repository.update({
    where: { id: repositoryId },
    data: {
      contributorUserIds: contributorState.contributorUserIds,
      videoContributorUserIds: contributorState.videoContributorUserIds,
    },
  });

  return contributorState.contributorUserIds;
};
