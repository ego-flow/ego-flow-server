import {
  PYTHON_TOKEN_HASH_ALGORITHM,
  PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS,
  PYTHON_TOKEN_PREFIX,
  PYTHON_TOKEN_RANDOM_BYTES,
} from "../../constants/auth/auth-constants";
import { toAppUserRole } from "../../mappers/user.mapper";
import { pythonTokenRepository } from "../../repositories/python-token.repository";
import type { CreatePythonTokenInput } from "../../types/auth/request";
import type { AppUserRole } from "../../types/auth";
import { createPrefixedRandomToken, hashValue } from "./crypto";
import { Forbidden, NotFound } from "../core/errors";

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

  const token = await pythonTokenRepository.findByHashForVerification(hashPythonToken(rawToken));

  if (!token?.user || token.user.deactivated) {
    return null;
  }

  if (shouldUpdateLastUsedAt(token.lastUsedAt)) {
    void pythonTokenRepository
      .updateLastUsedAt(token.id, new Date())
      .catch((error) => {
        console.warn("[python-token] failed to update last_used_at", {
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

const toIsoString = (value: Date | null) => value?.toISOString() ?? null;

export const issuePythonToken = async (userId: string, input: CreatePythonTokenInput) => {
  const rawToken = createRawPythonToken();
  const tokenHash = hashPythonToken(rawToken);
  const { created, rotatedPrevious } = await pythonTokenRepository.rotateForUser({
    userId,
    name: input.name,
    tokenHash,
  });

  return {
    id: created.id,
    name: created.name,
    token: rawToken,
    created_at: created.createdAt.toISOString(),
    rotated_previous: rotatedPrevious,
  };
};

export const getCurrentPythonToken = async (userId: string) => {
  const token = await pythonTokenRepository.findCurrentByUserId(userId);

  if (!token) {
    return null;
  }

  return {
    id: token.id,
    name: token.name,
    last_used_at: toIsoString(token.lastUsedAt),
    created_at: token.createdAt.toISOString(),
  };
};

export const listActivePythonTokensForAdmin = async () => {
  const tokens = await pythonTokenRepository.findActiveForAdmin();

  return tokens.flatMap((token) => {
    if (!token.user) {
      return [];
    }

    return [
      {
        id: token.id,
        user_id: token.userId,
        user_role: toAppUserRole(token.user.role),
        display_name: token.user.displayName,
        name: token.name,
        last_used_at: toIsoString(token.lastUsedAt),
        created_at: token.createdAt.toISOString(),
      },
    ];
  });
};

export const revokePythonToken = async (requestUserId: string, requestUserRole: AppUserRole, tokenId: string) => {
  const token = await pythonTokenRepository.findOwnerById(tokenId);

  if (!token) {
    throw NotFound("Python token not found.");
  }

  if (requestUserRole !== "admin" && token.userId !== requestUserId) {
    throw Forbidden("You do not have permission for this action.");
  }

  await pythonTokenRepository.deleteById(token.id);
};
