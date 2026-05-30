import { randomUUID } from "node:crypto";

import { RecordingSessionEndReason, RecordingSessionStatus } from "@prisma/client";

import {
  RECORDING_REGISTRATION_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
  STREAM_RECONCILE_INTERVAL_MS,
} from "../constants/stream/stream-constants";
import { AppError, Conflict, ErrorCode, Forbidden, NotFound } from "../lib/errors";
import { redis } from "../lib/redis";
import { getTargetDirectory } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { runtimeConfig as env } from "../config/runtime";
import type { AppUserRole } from "../types/auth";
import type { StreamRegisterInput } from "../schemas/stream.schema";
import type { RecordingSessionLiveCache } from "../types/stream";
import { repositoryService } from "./repository.service";
import { recordingSessionService } from "./recording-session.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamRecordingKey } from "../utils/stream-keys";

/**
 * 스트리밍 세션의 등록, 활성 조회, RTMP 인증 보조, reconcile 루프를 관리하는 서비스.
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
   * - repository maintain 권한 확인
   * - 아직 publish가 시작되지 않은 같은 사용자/repository/deviceType의 PENDING 세션은 재사용
   * - DB에 PENDING으로 남아 있는 세션은 age와 무관하게 재사용하고 updatedAt/Redis TTL을 갱신
   * - RecordingSession을 PENDING 상태로 생성하고 recording cache만 저장
   * - recordingSessionId만 반환하고, 실제 publish credential은 별도 publish-ticket 발급으로 분리함
   */
  async registerSession(
    userId: string,
    userRole: AppUserRole,
    input: StreamRegisterInput,
  ) {
    let access: Awaited<ReturnType<typeof repositoryService.assertRepositoryAccess>>;
    try {
      access = await repositoryService.assertRepositoryAccess(userId, userRole, input.repositoryId, "maintain");
    } catch (error) {
      if (this.isForbiddenError(error)) {
        await this.abortPendingSessionsAfterForbiddenAccess(
          input.repositoryId,
          userId,
          input.deviceType ?? null,
        );
      }
      throw error;
    }

    const existingSession = await this.findReusablePendingSession(
      access.repository.id,
      userId,
      input.deviceType ?? null,
    );

    if (existingSession) {
      console.info("[rtmp-register] reused-pending", {
        recordingSessionId: existingSession.id,
        repositoryId: access.repository.id,
        repositoryName: access.repository.name,
        ownerId: access.repository.ownerId,
        userId,
        deviceType: existingSession.deviceType,
        streamPath: existingSession.streamPath,
        status: existingSession.status,
      });

      return {
        recordingSessionId: existingSession.id,
      };
    }

    const recordingSessionId = randomUUID();
    const streamPath = this.buildStreamPath(access.repository.name, recordingSessionId);
    const session = await recordingSessionService.createSession({
      id: recordingSessionId,
      repositoryId: access.repository.id,
      ownerId: access.repository.ownerId,
      userId,
      ...(input.deviceType ? { deviceType: input.deviceType } : {}),
      streamPath,
      targetDirectory: getTargetDirectory(),
    });

    console.info("[rtmp-register] issued", {
      recordingSessionId: session.id,
      repositoryId: access.repository.id,
      repositoryName: access.repository.name,
      ownerId: access.repository.ownerId,
      userId,
      deviceType: input.deviceType ?? null,
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

  private isForbiddenError(error: unknown) {
    return error instanceof AppError && error.code === ErrorCode.FORBIDDEN;
  }

  private async abortPendingSessionsAfterForbiddenAccess(
    repositoryId: string,
    userId: string,
    deviceType: string | null,
  ) {
    const pendingSessions = await prisma.recordingSession.findMany({
      where: {
        repositoryId,
        userId,
        deviceType,
        status: RecordingSessionStatus.PENDING,
      },
      select: { id: true },
    });

    if (pendingSessions.length === 0) {
      return;
    }

    const abortedSessionIds: string[] = [];
    const finalizedAt = new Date();
    for (const session of pendingSessions) {
      const result = await prisma.recordingSession.updateMany({
        where: {
          id: session.id,
          status: RecordingSessionStatus.PENDING,
        },
        data: {
          status: RecordingSessionStatus.ABORTED,
          endReason: RecordingSessionEndReason.ACCESS_FORBIDDEN,
          finalizedAt,
        },
      });

      if (result.count > 0) {
        abortedSessionIds.push(session.id);
      }
    }

    if (abortedSessionIds.length === 0) {
      return;
    }

    await redis.del(
      ...abortedSessionIds.map((recordingSessionId) => streamRecordingKey(recordingSessionId)),
    );

    console.info("[rtmp-register] forbidden-pending-aborted", {
      repositoryId,
      userId,
      deviceType,
      recordingSessionIds: abortedSessionIds,
      endReason: RecordingSessionEndReason.ACCESS_FORBIDDEN,
    });
  }

  private async findReusablePendingSession(
    repositoryId: string,
    userId: string,
    deviceType: string | null,
  ) {
    const pendingSessions = await prisma.recordingSession.findMany({
      where: {
        repositoryId,
        userId,
        deviceType,
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
    await recordingSessionService.cachePendingSession(refreshedSession, RECORDING_REGISTRATION_TTL_SECONDS);

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

    if (
      session.status !== RecordingSessionStatus.PENDING &&
      session.status !== RecordingSessionStatus.STREAMING
    ) {
      throw Conflict(`Recording session is already in ${session.status} state.`);
    }

    const ticketGrant = await streamOwnershipService.issuePublishTicket({
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      userId: session.userId,
      streamPath: session.streamPath,
    });

    console.info("[rtmp-ticket] issued", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      userId: session.userId,
      streamPath: session.streamPath,
      ticketId: ticketGrant.ticket.ticketId,
      ticketExpiresAt: new Date(ticketGrant.ticket.expiresAt).toISOString(),
    });

    return {
      recording_session_id: session.id,
      repository_id: session.repositoryId,
      stream_path: session.streamPath,
      publish_ticket: ticketGrant.ticket.ticketId,
      rtmp_publish_base_url: streamOwnershipService.getPublishBaseUrl(env.RTMP_BASE_URL),
      whip_publish_url: streamOwnershipService.buildWhipPublishUrl(
        env.WHIP_BASE_URL,
        session.streamPath,
        ticketGrant.ticket.ticketId,
      ),
    };
  }

  /**
   * [HLS playback path 조립]
   * `/hls/live/{repository_name}/{recording_session_id}/index.m3u8` 형태의 origin-relative path를 만든다.
   */
  buildHlsPath(repoName: string, recordingSessionId: string) {
    const hlsBase = env.HLS_PATH_PREFIX.replace(/\/+$/, "");
    return `${hlsBase}/live/${repoName}/${recordingSessionId}/index.m3u8`;
  }

  /**
   * [WHEP playback path 조립]
   * MediaMTX native WHEP path인 `/live/{repository_name}/{recording_session_id}/whep` 형태의 origin-relative path를 만든다.
   */
  buildWhepPath(repoName: string, recordingSessionId: string) {
    const whepBase = env.WHEP_PATH_PREFIX.replace(/\/+$/, "");
    return `${whepBase}/${repoName}/${recordingSessionId}/whep`;
  }

  /**
   * [Live stream 목록 - Redis read-only]
   * Redis active set + live cache만 읽어 응답을 만든다. DB / MediaMTX는 조회하지 않는다.
   * 1. 요청자가 접근 가능한 repository id set 계산 (admin이면 null)
   * 2. SMEMBERS stream:active:sessions
   * 3. 각 id를 stream:recording:{id}로 MGET
   * 4. status === STREAMING + 접근 가능 repo만 응답에 포함
   *
   * cache가 없거나 깨졌거나 STREAMING이 아닌 entry는 무시만 한다 (cleanup은 hook/reconcile이 담당).
   */
  async listLiveStreams(requestUserId: string, requestUserRole: AppUserRole) {
    const accessibleRepoIds = await repositoryService.listAccessibleRepositoryIds(requestUserId, requestUserRole);
    const activeIds = await redis.smembers(STREAM_ACTIVE_SET_KEY);

    if (activeIds.length === 0) {
      return [];
    }

    const cacheKeys = activeIds.map((id) => streamRecordingKey(id));
    const cachedRaw = await redis.mget(...cacheKeys);

    const entries: RecordingSessionLiveCache[] = [];
    for (const raw of cachedRaw) {
      if (!raw) {
        continue;
      }
      let parsed: RecordingSessionLiveCache;
      try {
        parsed = JSON.parse(raw) as RecordingSessionLiveCache;
      } catch (_error) {
        continue;
      }
      if (parsed.status !== "STREAMING") {
        continue;
      }
      if (accessibleRepoIds && !accessibleRepoIds.has(parsed.repositoryId)) {
        continue;
      }
      entries.push(parsed);
    }

    const streams = entries.map((entry) => ({
      stream_id: entry.recordingSessionId,
      repository_id: entry.repositoryId,
      repository_name: entry.repositoryName,
      user_id: entry.userId,
      device_type: entry.deviceType ?? null,
      status: "live" as const,
      hls_path: this.buildHlsPath(entry.repositoryName, entry.recordingSessionId),
      whep_path: this.buildWhepPath(entry.repositoryName, entry.recordingSessionId),
    }));

    if (streams.length > 0) {
      console.info("[live-streams.list] generated", {
        requestUserId,
        requestUserRole,
        streamCount: streams.length,
      });
    }

    return streams;
  }

  /**
   * [Live stream 상세]
   * streamId(recording_session_id)로 단일 stream의 상세 metadata를 반환한다.
   * DB STREAMING 여부와 MediaMTX path 활성 여부를 교차 확인하여 playback_ready를 계산한다.
   * 접근 권한이 없거나 존재하지 않는 session은 404를 던진다.
   */
  async getLiveStreamDetail(streamId: string, requestUserId: string, requestUserRole: AppUserRole) {
    const session = await prisma.recordingSession.findUnique({ where: { id: streamId } });

    if (!session || session.status !== RecordingSessionStatus.STREAMING) {
      throw NotFound("Live stream not found.");
    }

    const access = await repositoryService.getRepositoryAccess(requestUserId, requestUserRole, session.repositoryId);
    if (!access) {
      throw NotFound("Live stream not found.");
    }

    const repoName = recordingSessionService.extractRepositoryName(session.streamPath);
    const activeStreamPaths = await this.getActiveStreamPaths();
    const playbackReady = activeStreamPaths ? activeStreamPaths.has(this.normalizeStreamPath(session.streamPath)) : true;

    return {
      stream_id: session.id,
      repository_id: session.repositoryId,
      repository_name: repoName,
      owner_id: session.ownerId,
      user_id: session.userId,
      device_type: session.deviceType ?? null,
      stream_path: session.streamPath,
      source_type: session.sourceType ?? null,
      source_id: session.sourceId ?? null,
      registered_at: session.createdAt.toISOString(),
      status: "live" as const,
      playback_ready: playbackReady,
    };
  }

  /**
   * [RTMP 인증 보조: live session 조회]
   * RTMP publish/read 인증 시 auth.service에서 호출.
   * Redis에서 stream path로 live cache를 조회하여 활성 세션 정보를 반환한다.
   * FINALIZING 상태인 세션은 이미 종료된 것이므로 null을 반환한다.
   */
  async findLiveSessionByStreamPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    const cache = await recordingSessionService.getLiveCacheByPath(streamPath);
    if (!cache) {
      return null;
    }

    if (cache.status === "FINALIZING") {
      return null;
    }

    return cache;
  }

  /**
   * [상태 정합성 루프 시작]
   * 서버 기동 시 5초 간격으로 reconcileSessions를 실행하는 타이머를 시작한다.
   * PENDING 타임아웃, STREAMING/STOP_REQUESTED인데 MediaMTX에 path가 없는 경우 등
   * hook 누락이나 비정상 종료로 인한 상태 불일치를 주기적으로 보정한다.
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
    }, STREAM_RECONCILE_INTERVAL_MS);

    this.reconcileTimer.unref();
  }

  /**
   * [MediaMTX active path 조회]
   * MediaMTX REST API(/v3/paths/list)를 호출하여 현재 실제로 송출 중인
   * stream path 집합을 반환한다.
   * API 호출 실패 시 null을 반환하여 필터링을 건너뛰게 한다.
   */
  private async getActiveStreamPaths(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        console.warn(`[streams] failed to query MediaMTX active paths: status ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const activeStreamPaths = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }

        const normalized = this.normalizeStreamPath(item.name);
        const parts = normalized.split("/");
        if (parts.length >= 3 && parts[0] === "live" && parts[1] && parts[2]) {
          activeStreamPaths.add(normalized);
        }
      }

      return activeStreamPaths;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[streams] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }

  private normalizeStreamPath(streamPath: string) {
    return streamPath.trim().replace(/^\/+|\/+$/g, "");
  }
}

export const streamService = new StreamService();
