import crypto from "crypto";

import { redis } from "../lib/redis";
import type { AppUserRole } from "../types/auth";
import { repositoryService } from "./repository.service";
import { streamService } from "./stream.service";

const HLS_AUTH_CACHE_TTL_SECONDS = 30;

const hlsAuthCacheKey = (credentialHash: string, repoName: string) =>
  `hlsauth:${credentialHash}:${repoName}`;

const hashCredential = (credential: string) =>
  crypto.createHash("sha256").update(credential).digest("hex");

export type HlsAuthOutcome =
  | { ok: true; repoName: string; cached: boolean }
  | { ok: false; reason: "invalid-path" | "stream-not-found" | "repo-access-denied" };

interface AuthorizeInput {
  rawCredential: string;
  path: string;
  userId: string;
  userRole: AppUserRole;
}

/**
 * [HLS playback gate]
 * Caddy `forward_auth` 진입점에서 호출되는 권한 검증 로직.
 * - credential은 이미 requireDashboardOrAppOrPython에서 검증되어 있으므로 여기서는 권한만 확인한다.
 * - cache key는 (credential SHA-256 hash) x repoName 조합 (30초 TTL).
 * - cache hit면 즉시 allow.
 * - miss면 live session 존재 여부와 repository read 권한을 확인한 뒤 cache.
 */
export class HlsAuthService {
  async authorize(input: AuthorizeInput): Promise<HlsAuthOutcome> {
    const repoName = this.extractRepositoryName(input.path);
    if (!repoName) {
      return { ok: false, reason: "invalid-path" };
    }

    const credentialHash = hashCredential(input.rawCredential);
    const cacheKey = hlsAuthCacheKey(credentialHash, repoName);

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

    await redis.set(cacheKey, "1", "EX", HLS_AUTH_CACHE_TTL_SECONDS);
    return { ok: true, repoName, cached: false };
  }

  /**
   * Caddy가 forward한 path는 둘 중 하나의 형태다.
   * - `/hls/live/{repo}/...` (orig request path)
   * - `/live/{repo}/...` (handle_path 이후)
   * 둘 다 처리한다.
   */
  private extractRepositoryName(path: string): string | null {
    const normalized = path.replace(/^\/+/, "").replace(/^hls\//, "");
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      return null;
    }
    return parts[1];
  }
}

export const hlsAuthService = new HlsAuthService();
