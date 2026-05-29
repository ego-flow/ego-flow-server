import { Prisma, RepoRole } from "@prisma/client";

import { prisma } from "../lib/prisma";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

type RepositoryContributorState = {
  contributors: string[];
  videoContributors: string[];
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
        videoContributors: true,
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
        recorder: {
          not: null,
        },
      },
      select: {
        recorder: true,
      },
    }),
  ]);
  const videoContributors = Array.from(
    new Set([
      ...normalizeContributorUserIds(repository?.videoContributors),
      ...videos.map((video) => video.recorder).filter((userId): userId is string => Boolean(userId)),
    ]),
  ).sort();
  const videoContributorSet = new Set(videoContributors);

  const adminUserIds = memberships
    .filter((membership) => membership.role === RepoRole.admin)
    .map((membership) => membership.userId);
  const maintainerUserIds = memberships
    .filter((membership) => membership.role === RepoRole.maintain)
    .map((membership) => membership.userId);
  const maintainerContributors = maintainerUserIds.filter((userId) => videoContributorSet.has(userId));

  return {
    contributors: Array.from(new Set([...adminUserIds, ...maintainerContributors])).sort(),
    videoContributors,
  };
};

export const computeRepositoryContributorUserIds = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
): Promise<string[]> => {
  const contributorState = await computeRepositoryContributorState(repositoryId, client);
  return contributorState.contributors;
};

export const refreshRepositoryContributors = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
) => {
  const contributorState = await computeRepositoryContributorState(repositoryId, client);

  await client.repository.update({
    where: { id: repositoryId },
    data: {
      contributors: contributorState.contributors,
      videoContributors: contributorState.videoContributors,
    },
  });

  return contributorState.contributors;
};
