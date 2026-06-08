import { STREAM_RECONCILE_INTERVAL_MS } from "../constants/stream/stream-constants";
import type { RepositoryRecord } from "../types/repository";
import type { StreamRegisterInput } from "../types/stream/request";
import { reconcileHttpUploads } from "../lib/streaming/http-upload-session";
import { recordingSessionService } from "../lib/streaming/recording-session";
import {
  issueRecordingPublishTicket,
  registerRecordingSession,
} from "../lib/streaming/stream-registration";
import type {
  StreamPublishTicketResponse,
  StreamRegisterResponse,
} from "../types/stream/response";

/**
 * 스트리밍 세션 등록, publish ticket 발급, reconcile 루프를 관리하는 서비스.
 * RecordingSessionService와 협력하여 세션 라이프사이클 전반을 처리한다.
 */
export class StreamService {
  private reconcileTimer?: NodeJS.Timeout;

  /**
   * [1단계: 세션 등록]
   * 앱에서 POST /api/v1/streams/register 호출 시 진입점.
   * - route middleware에서 검증된 repository context 사용
   * - 아직 publish가 시작되지 않은 같은 사용자/repository/deviceType의 PENDING 세션은 재사용
   * - DB에 PENDING으로 남아 있는 세션은 age와 무관하게 재사용하고 updatedAt/Redis TTL을 갱신
   * - RecordingSession을 PENDING 상태로 생성하고 PENDING cache를 저장
   * - recordingSessionId만 반환하고, 실제 publish credential은 별도 publish-ticket 발급으로 분리함
   */
  async registerSession(
    userId: string,
    repository: RepositoryRecord,
    input: StreamRegisterInput,
  ): Promise<StreamRegisterResponse> {
    return registerRecordingSession(userId, repository, input);
  }

  async issuePublishTicket(
    requestUserId: string,
    recordingSessionId: string,
  ): Promise<StreamPublishTicketResponse> {
    return issueRecordingPublishTicket(requestUserId, recordingSessionId);
  }

  /**
   * [상태 정합성 루프 시작]
   * 서버 기동 시 5초 간격으로 reconcileSessions를 실행하는 타이머를 시작한다.
   * MediaMTX STREAMING path 누락과 HTTP upload timeout 등
   * hook/API 누락이나 비정상 종료로 인한 상태 불일치를 주기적으로 보정한다.
   */
  startReconcileLoop() {
    if (this.reconcileTimer) {
      return;
    }

    this.reconcileTimer = setInterval(() => {
      void recordingSessionService.reconcileSessions().catch((error) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("[rtmp-reconcile] loop-failed", {
          reason: message,
        });
      });
      void reconcileHttpUploads().catch((error) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("[http-stream] reconcile-loop-failed", {
          reason: message,
        });
      });
    }, STREAM_RECONCILE_INTERVAL_MS);

    this.reconcileTimer.unref();
  }

}

export const streamService = new StreamService();
