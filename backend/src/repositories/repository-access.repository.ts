import type { Prisma, RepoRole, RepoVisibility } from "@prisma/client";

import { prisma } from "../lib/prisma";

export interface RepositoryAccessRecord {
  id: string;
  name: string;
  ownerId: string;
  visibility: RepoVisibility;
  description: string | null;
  tags: Prisma.JsonValue;
  deactivated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class RepositoryAccessRepository {
  async findRepositoryById(repositoryId: string): Promise<RepositoryAccessRecord | null> {
    return prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        description: true,
        tags: true,
        deactivated: true,
        createdAt: true,
        updatedAt: true,
      },
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
}

export const repositoryAccessRepository = new RepositoryAccessRepository();
