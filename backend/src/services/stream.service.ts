import { randomUUID } from "node:crypto";

import { RecordingSessionIngestType, RecordingSessionStatus } from "@prisma/client";

import {
  RECORDING_REGISTRATION_TTL_SECONDS,
  STREAM_RECONCILE_INTERVAL_MS,
} from "../constants/stream/stream-constants";
import { Conflict, Forbidden, NotFound, PreconditionFailed } from "../lib/errors";
import { redis } from "../lib/redis";
import { getTargetDirectory } from "../lib/storage";
import { prisma } from "../lib/prisma";
import type { AppUserRole } from "../types/auth";
import type { RepositoryRecord } from "../types/repository";
import type { StreamRegisterInput } from "../schemas/stream.schema";
import { streamRecordingKey } from "../lib/stream-keys";
import { recordingSessionService } from "./recording-session.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { httpStreamService } from "./http-stream.service";

/**
 * 스트리밍 세션 등록, publish ticket 발급, reconcile 루프를 관리하는 서비스.
 * RecordingSessionService와 협력하여 세션 라이프사이클 전반을 처리한다.
 */
export class StreamService {
  private reconcileTimer?: NodeJS.Timeout;

  extractRepositoryName(streamPath: string) {
    return recordingSessionService.extractRepositoryName(streamPath);
  }

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
  ) {
    const existingSession = await this.findReusablePendingSession(
      repository.id,
      userId,
      input.deviceType ?? null,
      input.ingestType,
    );

    if (existingSession) {
      console.info("[rtmp-register] reused-pending", {
        recordingSessionId: existingSession.id,
        repositoryId: repository.id,
        repositoryName: repository.name,
        ownerId: repository.ownerId,
        userId,
        deviceType: existingSession.deviceType,
        ingestType: existingSession.ingestType,
        streamPath: existingSession.streamPath,
        status: existingSession.status,
      });

      return {
        recordingSessionId: existingSession.id,
      };
    }

    const recordingSessionId = randomUUID();
    const streamPath = this.buildStreamPath(repository.name, recordingSessionId);
    const session = await recordingSessionService.createSession({
      id: recordingSessionId,
      repositoryId: repository.id,
      ownerId: repository.ownerId,
      userId,
      ...(input.deviceType ? { deviceType: input.deviceType } : {}),
      ingestType: input.ingestType,
      streamPath,
      targetDirectory: getTargetDirectory(),
    });

    console.info("[rtmp-register] issued", {
      recordingSessionId: session.id,
      repositoryId: repository.id,
      repositoryName: repository.name,
      ownerId: repository.ownerId,
      userId,
      deviceType: input.deviceType ?? null,
      ingestType: input.ingestType,
      streamPath,
      status: session.status,
    });

    return {
      recordingSessionId: session.id,
    };
  }

  private buildStreamPath(repositoryName: string, recordingSessionId: string) {
    return `live/${repositoryName}/${recordingSessionId}`;
  }

  private async findReusablePendingSession(
    repositoryId: string,
    userId: string,
    deviceType: string | null,
    ingestType: RecordingSessionIngestType,
  ) {
    const pendingSessions = await prisma.recordingSession.findMany({
      where: {
        repositoryId,
        userId,
        deviceType,
        ingestType,
        status: RecordingSessionStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
    });

    if (pendingSessions.length === 0) {
      return null;
    }

    const reusableSession = pendingSessions[0]!;

    const refreshedSession = await prisma.recordingSession.update({
      where: { id: reusableSession.id },
      data: {
        status: RecordingSessionStatus.PENDING,
        updatedAt: new Date(),
      },
    });
    await recordingSessionService.cachePendingSession(
      refreshedSession,
      RECORDING_REGISTRATION_TTL_SECONDS,
    );
    return refreshedSession;
  }

  async issuePublishTicket(
    requestUserId: string,
    _requestUserRole: AppUserRole,
    recordingSessionId: string,
  ) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });

    if (!session) {
      throw NotFound("Recording session not found.");
    }

    if (session.userId !== requestUserId) {
      throw Forbidden("Only the session owner can request a publish ticket.");
    }

    if (session.status !== RecordingSessionStatus.PENDING) {
      throw Conflict(`Recording session is already in ${session.status} state.`);
    }

    const pendingCache = await redis.get(streamRecordingKey(session.id));
    if (!pendingCache) {
      throw PreconditionFailed("Recording session registration has expired. Please register again.");
    }

    const ticketGrant = await streamOwnershipService.issuePublishTicket({
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      userId: session.userId,
      ingestType: session.ingestType,
      streamPath: session.streamPath,
    });

    console.info("[rtmp-ticket] issued", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      userId: session.userId,
      streamPath: session.streamPath,
      ticketId: ticketGrant.ticketId,
      ticketTtlSec: streamOwnershipService.getPublishTicketTtlSeconds(),
    });

    return {
      stream_path: session.streamPath,
      publish_ticket: ticketGrant.ticketId,
    };
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
      void httpStreamService.reconcileHttpUploads().catch((error) => {
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
