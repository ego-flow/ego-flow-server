import {
  LIVE_PLAYBACK_AUTH_CACHE_ALLOW_VALUE,
  LIVE_PLAYBACK_AUTH_CREDENTIAL_HASH_ALGORITHM,
  LIVE_PLAYBACK_AUTH_CACHE_TTL_SECONDS,
  type LivePlaybackAuthCachePrefix,
} from "../constants/stream/stream-constants";
import { redis } from "../lib/redis";
import type { AppUserRole } from "../types/auth";
import { hashValue } from "../utils/crypto";
import { repositoryService } from "./repository.service";
import { streamService } from "./stream.service";

export type LivePlaybackAuthOutcome =
  | { ok: true; repoName: string; cached: boolean }
  | { ok: false; reason: "invalid-path" | "stream-not-found" | "repo-access-denied" };

export interface LivePlaybackAuthorizeInput {
  rawCredential: string;
  path: string;
  userId: string;
  userRole: AppUserRole;
}

interface AuthorizeLivePlaybackAccessInput extends LivePlaybackAuthorizeInput {
  cacheKeyPrefix: LivePlaybackAuthCachePrefix;
  extractRepositoryName: (path: string) => string | null;
}

const livePlaybackAuthCacheKey = (
  cacheKeyPrefix: LivePlaybackAuthCachePrefix,
  credentialHash: string,
  repoName: string,
) => `${cacheKeyPrefix}:${credentialHash}:${repoName}`;

export const authorizeLivePlaybackAccess = async (
  input: AuthorizeLivePlaybackAccessInput,
): Promise<LivePlaybackAuthOutcome> => {
  const repoName = input.extractRepositoryName(input.path);
  if (!repoName) {
    return { ok: false, reason: "invalid-path" };
  }

  const credentialHash = hashValue(input.rawCredential, LIVE_PLAYBACK_AUTH_CREDENTIAL_HASH_ALGORITHM);
  const cacheKey = livePlaybackAuthCacheKey(input.cacheKeyPrefix, credentialHash, repoName);

  const cached = await redis.get(cacheKey);
  if (cached === LIVE_PLAYBACK_AUTH_CACHE_ALLOW_VALUE) {
    return { ok: true, repoName, cached: true };
  }

  const liveSession = await streamService.findLiveSessionByStreamPath(`live/${repoName}`);
  if (!liveSession) {
    return { ok: false, reason: "stream-not-found" };
  }

  const access = await repositoryService.getRepositoryAccess(
    input.userId,
    input.userRole,
    liveSession.repositoryId,
  );
  if (!access) {
    return { ok: false, reason: "repo-access-denied" };
  }

  await redis.set(cacheKey, LIVE_PLAYBACK_AUTH_CACHE_ALLOW_VALUE, "EX", LIVE_PLAYBACK_AUTH_CACHE_TTL_SECONDS);
  return { ok: true, repoName, cached: false };
};
