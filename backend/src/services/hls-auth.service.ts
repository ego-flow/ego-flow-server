import { LivePlaybackAuthCachePrefix } from "../constants/stream/stream-constants";
import {
  authorizeLivePlaybackAccess,
  type LivePlaybackAuthorizeInput,
  type LivePlaybackAuthOutcome,
} from "./live-playback-auth.service";

export type HlsAuthOutcome = LivePlaybackAuthOutcome;

/**
 * [HLS playback gate]
 * Caddy `forward_auth` 진입점에서 호출되는 권한 검증 로직.
 * - credential은 이미 requireDashboardOrAppOrPython에서 검증되어 있으므로 여기서는 권한만 확인한다.
 * - cache key는 (credential SHA-256 hash) x repoName 조합 (30초 TTL).
 * - cache hit면 즉시 allow.
 * - miss면 live session 존재 여부와 repository read 권한을 확인한 뒤 cache.
 */
export class HlsAuthService {
  async authorize(input: LivePlaybackAuthorizeInput): Promise<HlsAuthOutcome> {
    return authorizeLivePlaybackAccess({
      ...input,
      cacheKeyPrefix: LivePlaybackAuthCachePrefix.Hls,
      extractRepositoryName: this.extractRepositoryName,
    });
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
