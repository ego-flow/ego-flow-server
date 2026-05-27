import crypto from "crypto";

import { redis } from "../lib/redis";
import type { AppUserRole } from "../types/auth";
import { repositoryService } from "./repository.service";
import { streamService } from "./stream.service";

const WHEP_AUTH_CACHE_TTL_SECONDS = 30;

const whepAuthCacheKey = (credentialHash: string, repoName: string) =>
  `whepauth:${credentialHash}:${repoName}`;

const hashCredential = (credential: string) =>
  crypto.createHash("sha256").update(credential).digest("hex");

export type WhepAuthOutcome =
  | { ok: true; repoName: string; cached: boolean }
  | { ok: false; reason: "invalid-path" | "stream-not-found" | "repo-access-denied" };

interface AuthorizeInput {
  rawCredential: string;
  path: string;
  userId: string;
  userRole: AppUserRole;
}

/**
 * [WHEP playback gate]
 * Caddy `forward_auth` 진입점에서 호출되는 WebRTC 시청 권한 검증 로직.
 * - HLS gate(hlsAuthService)와 동일 패턴: credential은 이미 requireDashboardOrAppOrPython에서 검증됨.
 * - cache key는 (credential SHA-256 hash) x repoName 조합 (30초 TTL).
 * - cache hit면 즉시 allow.
 * - miss면 live session 존재 여부와 repository read 권한 확인 후 cache.
 */
export class WhepAuthService {
  async authorize(input: AuthorizeInput): Promise<WhepAuthOutcome> {
    const repoName = this.extractRepositoryName(input.path);
    if (!repoName) {
      return { ok: false, reason: "invalid-path" };
    }

    const credentialHash = hashCredential(input.rawCredential);
    const cacheKey = whepAuthCacheKey(credentialHash, repoName);

    const cached = await redis.get(cacheKey);
    if (cached === "1") {
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

    await redis.set(cacheKey, "1", "EX", WHEP_AUTH_CACHE_TTL_SECONDS);
    return { ok: true, repoName, cached: false };
  }

  /**
   * Caddy가 forward한 path는 둘 중 하나의 형태다.
   * - `/live/{repo}/whep`
   * - `/live/{repo}/whep/{sessionId}` (Location 기반 PATCH/DELETE)
   */
  private extractRepositoryName(path: string): string | null {
    const normalized = path.replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 3 || parts[0] !== "live" || !parts[1] || parts[2] !== "whep") {
      return null;
    }
    return parts[1];
  }
}

export const whepAuthService = new WhepAuthService();
