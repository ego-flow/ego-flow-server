import type { UserRole } from "@prisma/client";

import { prisma } from "../lib/infra/prisma";

export interface PythonTokenVerificationRecord {
  id: string;
  userId: string;
  lastUsedAt: Date | null;
  user: {
    id: string;
    role: UserRole;
    deactivated: boolean;
  } | null;
}

export interface PythonTokenSummaryRecord {
  id: string;
  name: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface AdminPythonTokenRecord extends PythonTokenSummaryRecord {
  userId: string;
  user: {
    id: string;
    role: UserRole;
    displayName: string;
  } | null;
}

export class PythonTokenRepository {
  async rotateForUser(input: { userId: string; name: string; tokenHash: string }) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.pythonTokens.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      });

      if (existing) {
        await tx.pythonTokens.delete({
          where: { id: existing.id },
        });
      }

      const created = await tx.pythonTokens.create({
        data: {
          userId: input.userId,
          name: input.name,
          tokenHash: input.tokenHash,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      });

      return {
        created,
        rotatedPrevious: Boolean(existing),
      };
    });
  }

  async findCurrentByUserId(userId: string): Promise<PythonTokenSummaryRecord | null> {
    return prisma.pythonTokens.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async findActiveForAdmin(): Promise<AdminPythonTokenRecord[]> {
    return prisma.pythonTokens.findMany({
      orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            role: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findOwnerById(tokenId: string): Promise<{ id: string; userId: string } | null> {
    return prisma.pythonTokens.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        userId: true,
      },
    });
  }

  async deleteById(tokenId: string) {
    await prisma.pythonTokens.delete({
      where: { id: tokenId },
    });
  }

  async findByHashForVerification(tokenHash: string): Promise<PythonTokenVerificationRecord | null> {
    return prisma.pythonTokens.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        userId: true,
        lastUsedAt: true,
        user: {
          select: {
            id: true,
            role: true,
            deactivated: true,
          },
        },
      },
    });
  }

  async updateLastUsedAt(tokenId: string, lastUsedAt: Date) {
    await prisma.pythonTokens.update({
      where: { id: tokenId },
      data: {
        lastUsedAt,
      },
    });
  }
}

export const pythonTokenRepository = new PythonTokenRepository();
