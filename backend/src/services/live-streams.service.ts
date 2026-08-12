import type { AppUserRole } from "../types/auth";
import type {
  HlsPlaybackTicketResponse,
  LiveStreamDetailResponse,
  LiveStreamResponse,
} from "../types/stream";
import {
  getLiveStreamDetail,
  issueLiveStreamHlsPlaybackTicket,
  listActiveLiveStreams,
} from "../lib/streaming/live-streams";

/**
 * /live-streams route use-case orchestration.
 *
 * Live 목록/상세/HLS playback ticket 발급처럼 dashboard와 Python client가 공유하는
 * live playback surface를 담당한다.
 */
export class LiveStreamsService {
  /**
   * [Live stream 목록 - Redis read-only]
   */
  async listLiveStreams(requestUserId: string, requestUserRole: AppUserRole): Promise<LiveStreamResponse[]> {
    return listActiveLiveStreams(requestUserId, requestUserRole);
  }

  /**
   * [Live stream 상세]
   */
  async getLiveStreamDetail(
    recordingSessionId: string,
    requestUserId: string,
    requestUserRole: AppUserRole,
  ): Promise<LiveStreamDetailResponse> {
    return getLiveStreamDetail(recordingSessionId, requestUserId, requestUserRole);
  }

  async issueHlsPlaybackTicket(
    recordingSessionId: string,
    requestUserId: string,
    requestUserRole: AppUserRole,
  ): Promise<HlsPlaybackTicketResponse> {
    return issueLiveStreamHlsPlaybackTicket(recordingSessionId, requestUserId, requestUserRole);
  }
}

export const liveStreamsService = new LiveStreamsService();
