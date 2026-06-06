import { Prisma, RepoRole } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

const repositoryMemberSelect = {
  userId: true,
  role: true,
  createdAt: true,
} satisfies Prisma.RepoMemberSelect;

export type RepositoryMemberRow = Prisma.RepoMemberGetPayload<{
  select: typeof repositoryMemberSelect;
}>;

export class RepoMemberRepository {
  async createAdminMember(repositoryId: string, userId: string): Promise<void> {
    await prisma.repoMember.create({
      data: {
        repositoryId,
        userId,
        role: RepoRole.admin,
      },
    });
  }

  async findMembershipRolesByUser(userId: string): Promise<Array<{ repositoryId: string; role: RepoRole }>> {
    return prisma.repoMember.findMany({
      where: { userId },
      select: {
        repositoryId: true,
        role: true,
      },
    });
  }

  async findAdminRepositoryIdsByUser(userId: string): Promise<string[]> {
    const memberships = await prisma.repoMember.findMany({
      where: {
        userId,
        role: RepoRole.admin,
      },
      select: { repositoryId: true },
    });

    return memberships.map((membership) => membership.repositoryId);
  }

  async findAdminUserIdsByRepository(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<string[]> {
    const memberships = await client.repoMember.findMany({
      where: {
        repositoryId,
        role: RepoRole.admin,
      },
      select: {
        userId: true,
      },
    });

    return memberships.map((membership) => membership.userId);
  }

  async findRepositoryMembers(repositoryId: string): Promise<RepositoryMemberRow[]> {
    return prisma.repoMember.findMany({
      where: { repositoryId },
      orderBy: [{ role: "desc" }, { userId: "asc" }],
      select: repositoryMemberSelect,
    });
  }

  async findMembershipRole(repositoryId: string, userId: string): Promise<RepoRole | null> {
    const membership = await prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });

    return membership?.role ?? null;
  }

  async findRepositoryMembership(repositoryId: string, userId: string): Promise<{ userId: string } | null> {
    return prisma.repoMember.findUnique({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
      select: { userId: true },
    });
  }

  async upsertRepositoryMember(input: {
    repositoryId: string;
    userId: string;
    role: RepoRole;
  }): Promise<void> {
    await prisma.repoMember.upsert({
      where: {
        repositoryId_userId: {
          repositoryId: input.repositoryId,
          userId: input.userId,
        },
      },
      update: {
        role: input.role,
      },
      create: {
        repositoryId: input.repositoryId,
        userId: input.userId,
        role: input.role,
      },
    });
  }

  async updateRepositoryMemberRole(input: {
    repositoryId: string;
    userId: string;
    role: RepoRole;
  }): Promise<void> {
    await prisma.repoMember.update({
      where: {
        repositoryId_userId: {
          repositoryId: input.repositoryId,
          userId: input.userId,
        },
      },
      data: {
        role: input.role,
      },
    });
  }

  async deleteRepositoryMember(repositoryId: string, userId: string): Promise<void> {
    await prisma.repoMember.delete({
      where: {
        repositoryId_userId: {
          repositoryId,
          userId,
        },
      },
    });
  }

  async deleteManyByRepositoryId(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.repoMember.deleteMany({ where: { repositoryId } });
  }
}

export const repoMemberRepository = new RepoMemberRepository();
