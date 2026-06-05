import {
  PYTHON_TOKEN_HASH_ALGORITHM,
  PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS,
  PYTHON_TOKEN_PREFIX,
  PYTHON_TOKEN_RANDOM_BYTES,
} from "../constants/auth/auth-constants";
import { Forbidden, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { toAppUserRole } from "../mappers/user.mapper";
import type { CreateApiTokenInput } from "../schemas/api-token.schema";
import type { AppUserRole } from "../types/auth";
import { createPrefixedRandomToken, hashValue } from "../lib/crypto";

const toIsoString = (value: Date | null) => value?.toISOString() ?? null;

const createRawToken = () => createPrefixedRandomToken(PYTHON_TOKEN_PREFIX, PYTHON_TOKEN_RANDOM_BYTES);

const hashToken = (rawToken: string) => hashValue(rawToken, PYTHON_TOKEN_HASH_ALGORITHM);

const shouldUpdateLastUsedAt = (lastUsedAt: Date | null) =>
  !lastUsedAt || Date.now() - lastUsedAt.getTime() >= PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS;

export class ApiTokenService {
  async issueToken(userId: string, input: CreateApiTokenInput) {
    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const { created, rotatedPrevious } = await prisma.$transaction(async (tx) => {
      const existing = await tx.apiToken.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (existing) {
        await tx.apiToken.delete({
          where: { id: existing.id },
        });
      }

      const created = await tx.apiToken.create({
        data: {
          userId,
          name: input.name,
          tokenHash,
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

    return {
      id: created.id,
      name: created.name,
      token: rawToken,
      created_at: created.createdAt.toISOString(),
      rotated_previous: rotatedPrevious,
    };
  }

  async getCurrentToken(userId: string) {
    const token = await prisma.apiToken.findUnique({
      where: { userId },
      select: {
        id: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    if (!token) {
      return null;
    }

    return {
      id: token.id,
      name: token.name,
      last_used_at: toIsoString(token.lastUsedAt),
      created_at: token.createdAt.toISOString(),
    };
  }

  async listActiveTokensForAdmin() {
    const query: Parameters<typeof prisma.apiToken.findMany>[0] = {
      orderBy: [{ userId: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        userId: true,
        name: true,
        lastUsedAt: true,
        createdAt: true,
      },
    };

    const tokens = await prisma.apiToken.findMany(query);
    if (tokens.length === 0) {
      return [];
    }

    const users = await prisma.user.findMany({
      where: {
        id: {
          in: Array.from(new Set(tokens.map((token) => token.userId))),
        },
      },
      select: {
        id: true,
        role: true,
        displayName: true,
      },
    });

    const usersById = new Map(users.map((user) => [user.id, user]));

    return tokens.flatMap((token) => {
      const user = usersById.get(token.userId);
      if (!user) {
        return [];
      }

      return [
        {
          id: token.id,
          user_id: token.userId,
          user_role: toAppUserRole(user.role),
          display_name: user.displayName,
          name: token.name,
          last_used_at: toIsoString(token.lastUsedAt),
          created_at: token.createdAt.toISOString(),
        },
      ];
    });
  }

  async revokeToken(requestUserId: string, requestUserRole: AppUserRole, tokenId: string) {
    const token = await prisma.apiToken.findUnique({
      where: { id: tokenId },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!token) {
      throw NotFound("Python token not found.");
    }

    if (requestUserRole !== "admin" && token.userId !== requestUserId) {
      throw Forbidden("You do not have permission for this action.");
    }

    await prisma.apiToken.delete({
      where: { id: token.id },
    });
  }

  async verifyPythonToken(rawToken: string): Promise<{ userId: string; role: AppUserRole } | null> {
    if (
      !rawToken.startsWith(PYTHON_TOKEN_PREFIX) ||
      rawToken.length !== PYTHON_TOKEN_PREFIX.length + PYTHON_TOKEN_RANDOM_BYTES * 2
    ) {
      return null;
    }

    const token = await prisma.apiToken.findUnique({
      where: {
        tokenHash: hashToken(rawToken),
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

    if (!token?.user || token.user.deactivated) {
      return null;
    }

    if (shouldUpdateLastUsedAt(token.lastUsedAt)) {
      void prisma.apiToken
        .update({
          where: { id: token.id },
          data: {
            lastUsedAt: new Date(),
          },
        })
        .catch((error) => {
          console.warn("[api-token] failed to update last_used_at", {
            tokenId: token.id,
            userId: token.userId,
            error,
          });
        });
    }

    return {
      userId: token.user.id,
      role: toAppUserRole(token.user.role),
    };
  }
}

export const apiTokenService = new ApiTokenService();
