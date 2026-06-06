import { Prisma, RepoVisibility } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

const repositorySummarySelect = {
  id: true,
  name: true,
  ownerId: true,
  visibility: true,
  description: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RepositorySelect;

const repositoryResolveSelect = {
  ...repositorySummarySelect,
  deactivated: true,
} satisfies Prisma.RepositorySelect;

export type RepositorySummaryRow = Prisma.RepositoryGetPayload<{
  select: typeof repositorySummarySelect;
}>;

export type RepositoryResolveRow = Prisma.RepositoryGetPayload<{
  select: typeof repositoryResolveSelect;
}>;

export const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class RepositoriesRepository {
  async findActiveRepositoryIds(): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: { deactivated: false },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findRepositoryIdsByOwner(ownerId: string): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: { ownerId },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActiveRepositoryIdsByIds(repositoryIds: string[]): Promise<string[]> {
    if (repositoryIds.length === 0) {
      return [];
    }

    const repositories = await prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        deactivated: false,
      },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActivePublicRepositoryIds(): Promise<string[]> {
    const repositories = await prisma.repository.findMany({
      where: {
        visibility: RepoVisibility.public,
        deactivated: false,
      },
      select: { id: true },
    });

    return repositories.map((repository) => repository.id);
  }

  async findActiveRepositorySummaries(): Promise<RepositorySummaryRow[]> {
    return prisma.repository.findMany({
      where: { deactivated: false },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findActiveRepositorySummariesForAccess(input: {
    memberRepositoryIds: string[];
    includePublic: boolean;
  }): Promise<RepositorySummaryRow[]> {
    const accessWhere: Prisma.RepositoryWhereInput = input.includePublic
      ? {
          OR: [
            { visibility: RepoVisibility.public },
            { id: { in: input.memberRepositoryIds } },
          ],
        }
      : {
          id: { in: input.memberRepositoryIds },
        };

    return prisma.repository.findMany({
      where: {
        AND: [
          { deactivated: false },
          accessWhere,
        ],
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findRepositoryByOwnerAndName(ownerId: string, name: string): Promise<RepositoryResolveRow | null> {
    return prisma.repository.findUnique({
      where: {
        ownerId_name: {
          ownerId,
          name,
        },
      },
      select: repositoryResolveSelect,
    });
  }

  async findRepositoryById(repositoryId: string): Promise<RepositoryResolveRow | null> {
    return prisma.repository.findUnique({
      where: { id: repositoryId },
      select: repositoryResolveSelect,
    });
  }

  async findRepositoryState(repositoryId: string): Promise<{ id: string; deactivated: boolean } | null> {
    return prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        deactivated: true,
      },
    });
  }

  async createRepository(input: {
    name: string;
    ownerId: string;
    visibility: RepoVisibility;
    description: string | null;
    tags: Prisma.InputJsonValue;
    contributors: Prisma.InputJsonValue;
  }): Promise<RepositorySummaryRow> {
    return prisma.repository.create({
      data: input,
      select: repositorySummarySelect,
    });
  }

  async updateRepository(input: {
    repositoryId: string;
    name: string;
    visibility: RepoVisibility;
    description: string | null;
    tags: Prisma.InputJsonValue;
  }): Promise<RepositorySummaryRow> {
    return prisma.repository.update({
      where: { id: input.repositoryId },
      data: {
        name: input.name,
        visibility: input.visibility,
        description: input.description,
        tags: input.tags,
      },
      select: repositorySummarySelect,
    });
  }

  async markRepositoryDeactivated(repositoryId: string): Promise<void> {
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { deactivated: true },
    });
  }

  async findDeactivatedRepositorySummariesForSystemAdmin(): Promise<RepositorySummaryRow[]> {
    return prisma.repository.findMany({
      where: { deactivated: true },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findDeactivatedRepositorySummariesByIds(repositoryIds: string[]): Promise<RepositorySummaryRow[]> {
    if (repositoryIds.length === 0) {
      return [];
    }

    return prisma.repository.findMany({
      where: {
        id: { in: repositoryIds },
        deactivated: true,
      },
      orderBy: [{ ownerId: "asc" }, { name: "asc" }],
      select: repositorySummarySelect,
    });
  }

  async findContributors(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<Prisma.JsonValue | null> {
    const repository = await client.repository.findUnique({
      where: { id: repositoryId },
      select: {
        contributors: true,
      },
    });

    return repository?.contributors ?? null;
  }

  async findContributorsForUpdate(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<Prisma.JsonValue | null> {
    await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM repositories
      WHERE id = ${repositoryId}::uuid
      FOR UPDATE
    `);

    const repository = await client.repository.findUnique({
      where: { id: repositoryId },
      select: {
        contributors: true,
      },
    });

    return repository?.contributors ?? null;
  }

  async updateContributors(
    repositoryId: string,
    contributors: Prisma.InputJsonValue,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.repository.update({
      where: { id: repositoryId },
      data: { contributors },
    });
  }

  async deleteRepository(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.repository.delete({ where: { id: repositoryId } });
  }
}

export const repositoriesRepository = new RepositoriesRepository();
