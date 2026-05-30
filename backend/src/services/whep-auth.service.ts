import { LivePlaybackAuthCachePrefix } from "../constants/stream/stream-constants";
import {
  authorizeLivePlaybackAccess,
  type LivePlaybackAuthorizeInput,
  type LivePlaybackAuthOutcome,
} from "./live-playback-auth.service";

export type WhepAuthOutcome = LivePlaybackAuthOutcome;

/**
 * [WHEP playback gate]
 * Caddy `forward_auth` 진입점에서 호출되는 WebRTC 시청 권한 검증 로직.
 * - HLS gate(hlsAuthService)와 동일 패턴: credential은 이미 requireDashboardOrAppOrPython에서 검증됨.
 * - cache key는 (credential SHA-256 hash) x repoName 조합 (30초 TTL).
 * - cache hit면 즉시 allow.
 * - miss면 live session 존재 여부와 repository read 권한 확인 후 cache.
 */
export class WhepAuthService {
  async authorize(input: LivePlaybackAuthorizeInput): Promise<WhepAuthOutcome> {
    return authorizeLivePlaybackAccess({
      ...input,
      cacheKeyPrefix: LivePlaybackAuthCachePrefix.Whep,
      extractPlaybackTarget: this.extractPlaybackTarget,
    });
  }

  /**
   * Caddy가 forward한 path는 둘 중 하나의 형태다.
   * - `/live/{repo}/{recordingSessionId}/whep`
   * - `/live/{repo}/{recordingSessionId}/whep/{sessionId}` (Location 기반 PATCH/DELETE)
   */
  private extractPlaybackTarget(path: string): { repoName: string; streamPath: string } | null {
    const normalized = path.replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 4 || parts[0] !== "live" || !parts[1] || !parts[2] || parts[3] !== "whep") {
      return null;
    }
    return {
      repoName: parts[1],
      streamPath: `live/${parts[1]}/${parts[2]}`,
    };
  }
}

export const whepAuthService = new WhepAuthService();
