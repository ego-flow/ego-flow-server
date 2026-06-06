import {
  PYTHON_TOKEN_HASH_ALGORITHM,
  PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS,
  PYTHON_TOKEN_PREFIX,
  PYTHON_TOKEN_RANDOM_BYTES,
} from "../../constants/auth/auth-constants";
import { toAppUserRole } from "../../mappers/user.mapper";
import type { AppUserRole } from "../../types/auth";
import { createPrefixedRandomToken, hashValue } from "../crypto";
import { prisma } from "../prisma";

export const createRawPythonToken = () => createPrefixedRandomToken(PYTHON_TOKEN_PREFIX, PYTHON_TOKEN_RANDOM_BYTES);

export const hashPythonToken = (rawToken: string) => hashValue(rawToken, PYTHON_TOKEN_HASH_ALGORITHM);

const shouldUpdateLastUsedAt = (lastUsedAt: Date | null) =>
  !lastUsedAt || Date.now() - lastUsedAt.getTime() >= PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS;

export const verifyPythonToken = async (rawToken: string): Promise<{ userId: string; role: AppUserRole } | null> => {
  if (
    !rawToken.startsWith(PYTHON_TOKEN_PREFIX) ||
    rawToken.length !== PYTHON_TOKEN_PREFIX.length + PYTHON_TOKEN_RANDOM_BYTES * 2
  ) {
    return null;
  }

  const token = await prisma.apiToken.findUnique({
    where: {
      tokenHash: hashPythonToken(rawToken),
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
};
