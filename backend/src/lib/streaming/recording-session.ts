import {
  RecordingSessionIngestType,
} from "@prisma/client";

import {
  RECORDING_REGISTRATION_TTL_SECONDS,
} from "../../constants/stream/stream-constants";
import { extractRepositoryNameFromStreamPath } from "./stream-paths";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type { RecordingSessionLiveCache } from "../../types/stream";
import {
  cachePendingRecordingSession,
  getRecordingSessionLiveCacheById,
  getRecordingSessionLiveCacheByPath,
} from "./recording-session-cache";
import { tryEnqueueRecordingFinalize } from "./recording-finalize";
import {
  getMediamtxActiveStreamPaths,
  reconcileMediamtxRecordingSessions,
} from "./recording-reconcile";

/**
 * RecordingSession 라이프사이클 전체를 관리하는 핵심 서비스.
 *
 * 상태 흐름:
 *   PENDING → STREAMING → CLOSED
 *   PENDING → CLOSED (권한 회수)
 *
 * RecordingSession.status는 RTMP streaming session 자체의 상태만 표현한다.
 * raw segment 기록 및 후처리 상태는 RecordingSegment.status가 담당한다.
 *
 * Redis live/pending cache를 함께 관리하며,
 * hook 서비스 및 STREAMING reconcile 루프와 협력해 상태를 진행시킨다.
 */
export class RecordingSessionService {
  /**
   * [세션 생성 - PENDING]
   * stream 등록 시 호출. RecordingSession을 PENDING 상태로 DB에 생성하고,
   * Redis에 PENDING cache를 5분 TTL로 저장한다.
   * publish-ticket은 이 Redis cache가 살아 있는 PENDING session에만 발급된다.
   */
  async createSession(params: {
    id?: string;
    repositoryId: string;
    ownerId: string;
    userId: string;
    deviceType?: string;
    ingestType: RecordingSessionIngestType;
    streamPath: string;
    targetDirectory: string;
  }) {
    const session = await recordingSessionRepository.create(params);

    await this.cachePendingSession(session, RECORDING_REGISTRATION_TTL_SECONDS);

    console.info("[rtmp-state] pending-created", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      ownerId: session.ownerId,
      userId: session.userId,
      deviceType: session.deviceType,
      ingestType: session.ingestType,
      streamPath: session.streamPath,
      registrationTtlSec: RECORDING_REGISTRATION_TTL_SECONDS,
    });

    return session;
  }

  async cachePendingSession(
    session: {
      id: string;
      repositoryId: string;
      ownerId: string;
      userId: string;
      deviceType: string | null;
      ingestType: RecordingSessionIngestType;
      streamPath: string;
    },
    ttlSeconds: number,
  ) {
    await cachePendingRecordingSession(session, ttlSeconds);
  }

  /**
   * [segment processing job enqueue 시도]
   * Streaming session이 CLOSED로 닫힌 뒤 raw segment 후처리 작업을 BullMQ 큐에 넣는다.
   * 판단 순서:
   * 1. session이 CLOSED가 아니면 아직 enqueue하지 않는다.
   * 2. 단일 segment가 없거나 아직 WRITING이면 segment-complete를 더 기다린다.
   * 3. 단일 segment가 WRITE_DONE이면 finalize job을 enqueue한다.
   *
   * 후처리 재시도 기준은 RecordingSession.status가 아니라 RecordingSegment.status=WRITE_DONE이다.
   */
  async tryEnqueueFinalize(recordingSessionId: string): Promise<boolean> {
    return tryEnqueueRecordingFinalize(recordingSessionId);
  }

  /**
   * [상태 정합성 보정 - reconcile]
   * 5초 간격으로 실행. 비정상 종료로 인한 상태 불일치를 보정한다.
   * - STREAMING: active path가 없거나 closedAt이 기록되어 있으면 CLOSED로 보정 후 segment complete 기반 enqueue 시도
   */
  async reconcileSessions() {
    await reconcileMediamtxRecordingSessions({
      getActiveStreamPaths: () => this.getActiveStreamPaths(),
      tryEnqueueFinalize: (recordingSessionId) => this.tryEnqueueFinalize(recordingSessionId),
    });
  }

  /**
   * [Live session 조회]
   * stream path에서 recordingSessionId를 추출하여 Redis live/pending cache를 조회한다.
   * RTMP/HLS 인증에서 사용된다.
   */
  async getLiveCacheByPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    return getRecordingSessionLiveCacheByPath(streamPath);
  }

  async getLiveCacheByRecordingSessionId(recordingSessionId: string): Promise<RecordingSessionLiveCache | null> {
    return getRecordingSessionLiveCacheById(recordingSessionId);
  }

  /**
   * [stream path → repository 이름 추출]
   * "live/{repoName}/{recordingSessionId}" 형식의 stream path에서 repository 이름 부분을 추출한다.
   * 형식이 맞지 않으면 에러를 던진다.
   */
  private extractRepositoryName(streamPath: string): string {
    return extractRepositoryNameFromStreamPath(streamPath);
  }

  private async getActiveStreamPaths(): Promise<Set<string> | null> {
    return getMediamtxActiveStreamPaths();
  }

}

export const recordingSessionService = new RecordingSessionService();
