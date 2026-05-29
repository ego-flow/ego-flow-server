import { Prisma, RepoRole } from "@prisma/client";

import { prisma } from "../lib/prisma";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

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
  const [repository, memberships, videos] = await Promise.all([
    client.repository.findUnique({
      where: { id: repositoryId },
      select: {
        contributors: true,
      },
    }),
    client.repoMember.findMany({
      where: {
        repositoryId,
        role: RepoRole.admin,
      },
      select: {
        userId: true,
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

  return Array.from(
    new Set([
      ...normalizeContributorUserIds(repository?.contributors),
      ...memberships.map((membership) => membership.userId),
      ...videos.map((video) => video.recorder).filter((userId): userId is string => Boolean(userId)),
    ]),
  ).sort();
};

export const refreshRepositoryContributors = async (
  repositoryId: string,
  client: PrismaClientLike = prisma,
) => {
  const contributors = await computeRepositoryContributorUserIds(repositoryId, client);

  await client.repository.update({
    where: { id: repositoryId },
    data: {
      contributors,
    },
  });

  return contributors;
};
