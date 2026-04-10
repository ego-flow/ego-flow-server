import { RecordingSessionEndReason, RecordingSessionStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
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

const RECONCILE_INTERVAL_MS = 5 * 1000;
const FIRST_PUBLISH_DEADLINE_MS = 5 * 60 * 1000;

const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

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
   * - 해당 repository에 이미 활성 스트림이 없는지 검증
   * - RecordingSession을 PENDING 상태로 생성하고 Redis에 live pointer 저장
   * - recording session metadata를 반환하고, 실제 publish credential은 별도 publish-ticket 발급으로 분리함
   */
  async registerSession(
    userId: string,
    userRole: AppUserRole,
    input: StreamRegisterInput,
  ) {
    const access = await repositoryService.assertRepositoryAccess(userId, userRole, input.repository_id, "maintain");
    await this.ensureRepositoryPathIsAvailable(access.repository.id, access.repository.name);

    const streamPath = `live/${access.repository.name}`;
    const session = await recordingSessionService.createSession({
      repositoryId: access.repository.id,
      ownerId: access.repository.ownerId,
      userId,
      ...(input.device_type ? { deviceType: input.device_type } : {}),
      streamPath,
      targetDirectory: getTargetDirectory(),
    });

    console.info("[rtmp-register] issued", {
      recordingSessionId: session.id,
      repositoryId: access.repository.id,
      repositoryName: access.repository.name,
      ownerId: access.repository.ownerId,
      userId,
      deviceType: input.device_type ?? null,
      streamPath,
      status: session.status,
    });

    return {
      recording_session_id: session.id,
      repository_id: access.repository.id,
      repository_name: access.repository.name,
      stream_path: streamPath,
      status: "pending" as const,
    };
  }

  async issuePublishTicket(
    requestUserId: string,
    requestUserRole: AppUserRole,
    recordingSessionId: string,
  ) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    await repositoryService.assertRepositoryAccess(requestUserId, requestUserRole, session.repositoryId, "maintain");

    if (session.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "Only the session owner can request a publish ticket.");
    }

    if (
      session.status !== RecordingSessionStatus.PENDING &&
      session.status !== RecordingSessionStatus.STREAMING
    ) {
      throw new AppError(409, "CONFLICT", `Recording session is already in ${session.status} state.`);
    }

    const firstPublishDeadlineMs = session.createdAt.getTime() + FIRST_PUBLISH_DEADLINE_MS;
    if (session.status === RecordingSessionStatus.PENDING && Date.now() > firstPublishDeadlineMs) {
      throw new AppError(409, "REGISTRATION_TIMEOUT", "Recording session registration expired before publish started.");
    }

    const repositoryName = recordingSessionService.extractRepositoryName(session.streamPath);

    try {
      const ticketGrant = await streamOwnershipService.issuePublishTicket({
        recordingSessionId: session.id,
        repositoryId: session.repositoryId,
        repositoryName,
        userId: session.userId,
        streamPath: session.streamPath,
      });

      if (ticketGrant.revokedTicket) {
        console.info("[rtmp-ticket] revoked", {
          recordingSessionId: ticketGrant.revokedTicket.recordingSessionId,
          repositoryId: ticketGrant.revokedTicket.repositoryId,
          repositoryName: ticketGrant.revokedTicket.repositoryName,
          userId: ticketGrant.revokedTicket.userId,
          streamPath: ticketGrant.revokedTicket.streamPath,
          ticketId: ticketGrant.revokedTicket.ticketId,
          connectionId: ticketGrant.revokedTicket.connectionId,
          generation: ticketGrant.revokedTicket.generation,
          reason: "superseded-by-new-publish-ticket",
        });
      }

      console.info(
        ticketGrant.ownerOutcome === "takeover" ? "[rtmp-ticket] takeover-issued" : "[rtmp-ticket] issued",
        {
          recordingSessionId: session.id,
          repositoryId: session.repositoryId,
          repositoryName,
          userId: session.userId,
          streamPath: session.streamPath,
          ticketId: ticketGrant.ticket.ticketId,
          connectionId: ticketGrant.ticket.connectionId,
          generation: ticketGrant.ticket.generation,
          ticketExpiresAt: new Date(ticketGrant.ticket.expiresAt).toISOString(),
          ownerLeaseExpiresAt: new Date(ticketGrant.owner.leaseExpiresAt).toISOString(),
        },
      );

      await recordingSessionService.markPublishTicketIssued(session.id);

      return {
        recording_session_id: session.id,
        repository_id: session.repositoryId,
        repository_name: repositoryName,
        stream_path: session.streamPath,
        connection_id: ticketGrant.ticket.connectionId,
        generation: ticketGrant.ticket.generation,
        publish_ticket: ticketGrant.ticket.ticketId,
        publish_ticket_expires_at: new Date(ticketGrant.ticket.expiresAt).toISOString(),
        rtmp_publish_base_url: streamOwnershipService.getPublishBaseUrl(env.RTMP_BASE_URL),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "outcome" in error &&
        error.outcome === "rejected" &&
        "existing" in error
      ) {
        const existing = error.existing as {
          generation?: number;
          recordingSessionId?: string;
          connectionId?: string;
          userId?: string;
          leaseExpiresAt?: number;
        };
        console.warn("[rtmp-ticket] rejected", {
          recordingSessionId: session.id,
          repositoryId: session.repositoryId,
          repositoryName,
          userId: session.userId,
          streamPath: session.streamPath,
          existingGeneration: existing.generation ?? null,
          existingRecordingSessionId: existing.recordingSessionId ?? null,
          existingConnectionId: existing.connectionId ?? null,
          existingUserId: existing.userId ?? null,
          existingLeaseExpiresAt: existing.leaseExpiresAt
            ? new Date(existing.leaseExpiresAt).toISOString()
            : null,
          reason: "healthy-owner-exists",
        });
        throw new AppError(409, "CONFLICT", "Repository already has a healthy active publisher.");
      }

      throw error;
    }
  }

  async refreshPublishConnectionLease(
    requestUserId: string,
    requestUserRole: AppUserRole,
    recordingSessionId: string,
    connectionId: string,
    generation: number,
  ) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    await repositoryService.assertRepositoryAccess(requestUserId, requestUserRole, session.repositoryId, "maintain");

    if (session.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "Only the session owner can refresh the publish heartbeat.");
    }

    if (
      session.status === RecordingSessionStatus.FINALIZING ||
      session.status === RecordingSessionStatus.COMPLETED ||
      session.status === RecordingSessionStatus.FAILED ||
      session.status === RecordingSessionStatus.ABORTED
    ) {
      throw new AppError(
        409,
        "RECORDING_SESSION_NOT_ACTIVE",
        `Recording session is already in ${session.status} state.`,
      );
    }

    if (session.status === RecordingSessionStatus.STOP_REQUESTED) {
      throw new AppError(
        409,
        "STALE_PUBLISH_CONNECTION",
        "Recording session is stopping; the current publish connection is no longer refreshable.",
      );
    }

    const refreshResult = await streamOwnershipService.refreshConnectionLease({
      repositoryId: session.repositoryId,
      recordingSessionId: session.id,
      connectionId,
      generation,
      ...(session.sourceId ? { sourceId: session.sourceId } : {}),
      ...(session.sourceType ? { sourceType: session.sourceType } : {}),
    });

    if (refreshResult.outcome === "rejected") {
      const logPayload = {
        recordingSessionId: session.id,
        repositoryId: session.repositoryId,
        repositoryName: recordingSessionService.extractRepositoryName(session.streamPath),
        userId: session.userId,
        connectionId,
        generation,
        reason: refreshResult.reason,
      };

      if (refreshResult.reason === "owner-missing" || refreshResult.reason === "connection-missing") {
        console.warn("[rtmp-owner] heartbeat-rejected", logPayload);
        throw new AppError(
          409,
          "OWNER_LEASE_MISSING",
          "Publish ownership metadata is missing; request a new publish ticket before reconnecting.",
        );
      }

      console.warn("[rtmp-owner] generation-mismatch", logPayload);
      throw new AppError(
        409,
        "STALE_PUBLISH_CONNECTION",
        "Publish connection is stale; request a new publish ticket before reconnecting.",
      );
    }

    console.info("[rtmp-owner] heartbeat-refreshed", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: recordingSessionService.extractRepositoryName(session.streamPath),
      userId: session.userId,
      connectionId,
      generation,
      ownerStatus: refreshResult.owner.status,
      leaseExpiresAt: new Date(refreshResult.owner.leaseExpiresAt).toISOString(),
    });

    return {
      ok: true,
      recording_session_id: session.id,
      connection_id: connectionId,
      generation,
      lease_expires_at: new Date(refreshResult.owner.leaseExpiresAt).toISOString(),
      owner_status: refreshResult.owner.status,
    };
  }

  /**
   * [활성 스트림 목록 조회]
   * DB에서 STREAMING 상태의 세션을 조회한 뒤:
   * 1. 요청자의 repository read 권한으로 필터링
   * 2. MediaMTX API에서 실제 active path와 교집합
   * 3. HLS URL을 포함한 응답 반환
   * 대시보드 Live 페이지에서 polling하여 사용한다.
   */
  async listActiveSessions(requestUserId: string, requestUserRole: AppUserRole) {
    const sessions = await prisma.recordingSession.findMany({
      where: { status: RecordingSessionStatus.STREAMING },
    });

    if (sessions.length === 0) {
      return [];
    }

    const visibleResults = await Promise.all(
      sessions.map(async (session) => ({
        session,
        access: await repositoryService.getRepositoryAccess(requestUserId, requestUserRole, session.repositoryId),
      })),
    );

    const visible = visibleResults
      .filter((result): result is { session: (typeof sessions)[0]; access: NonNullable<typeof result.access> } =>
        Boolean(result.access),
      )
      .map((result) => result.session);

    const activeRepoNames = await this.getActiveRepositoryNames();
    const activeVisible = activeRepoNames
      ? visible.filter((session) => {
          const repoName = recordingSessionService.extractRepositoryName(session.streamPath);
          return activeRepoNames.has(repoName);
        })
      : visible;

    const hlsBase = env.HLS_BASE_URL.replace(/\/+$/, "");
    const streams = activeVisible
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .map((session) => {
        const repoName = recordingSessionService.extractRepositoryName(session.streamPath);
        return {
          repository_id: session.repositoryId,
          repository_name: repoName,
          owner_id: session.ownerId,
          user_id: session.userId,
          device_type: session.deviceType ?? null,
          hls_url: `${hlsBase}/live/${repoName}/index.m3u8`,
          registered_at: session.createdAt.toISOString(),
        };
      });

    if (streams.length > 0) {
      console.info("[streams.active] generated playback URLs", {
        requestUserId,
        requestUserRole,
        hlsBase,
        streamCount: streams.length,
        streams: streams.map((stream) => ({
          repository_id: stream.repository_id,
          repository_name: stream.repository_name,
          hls_url: stream.hls_url,
          registered_at: stream.registered_at,
        })),
      });
    }

    return streams;
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
    }, RECONCILE_INTERVAL_MS);

    this.reconcileTimer.unref();
  }

  /**
   * [등록 전 중복 검사]
   * 해당 repository에 이미 활성 스트림이 있는지 확인한다.
   * MediaMTX active path와 DB(PENDING/STREAMING/STOP_REQUESTED)를 모두 체크하고,
   * register 후 5분을 넘겼거나 publish ticket 이후 owner lease가 사라진 PENDING 세션은 ABORTED 처리하여 새 등록을 허용한다.
   * Redis에 남아있는 stale pointer도 정리한다.
   */
  private async ensureRepositoryPathIsAvailable(repositoryId: string, repositoryName: string) {
    const activeRepoNames = await this.getActiveRepositoryNames();
    if (activeRepoNames?.has(repositoryName)) {
      console.warn("[rtmp-register] conflict-active-path", {
        repositoryId,
        repositoryName,
        reason: "mediamtx-active-path",
      });
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const existingSession = await prisma.recordingSession.findFirst({
      where: {
        repositoryId,
        status: {
          in: [RecordingSessionStatus.PENDING, RecordingSessionStatus.STREAMING, RecordingSessionStatus.STOP_REQUESTED],
        },
      },
    });

    if (existingSession) {
      if (existingSession.status === RecordingSessionStatus.PENDING) {
        const liveCache = await recordingSessionService.getLiveCacheByRecordingSessionId(existingSession.id);
        const publishTicketIssuedAtMs = liveCache?.publishTicketIssuedAt
          ? Date.parse(liveCache.publishTicketIssuedAt)
          : Number.NaN;
        const hasPublishTicketIssuedAt = Number.isFinite(publishTicketIssuedAtMs);
        const currentOwner = await streamOwnershipService.getCurrentOwnerForRepository(repositoryId);
        const ownerMatchesSession = currentOwner?.recordingSessionId === existingSession.id;
        const ownerIsStale = currentOwner ? streamOwnershipService.isStaleOwner(currentOwner) : true;

        if (hasPublishTicketIssuedAt && (!currentOwner || !ownerMatchesSession || ownerIsStale)) {
          console.info("[rtmp-register] pending-claimed-owner-missing-or-stale-cleanup", {
            repositoryId,
            repositoryName,
            staleRecordingSessionId: existingSession.id,
            publishTicketIssuedAt: liveCache?.publishTicketIssuedAt ?? null,
            ownerConnectionId: currentOwner?.connectionId ?? null,
            ownerGeneration: currentOwner?.generation ?? null,
            ownerLeaseExpiresAt: currentOwner
              ? new Date(currentOwner.leaseExpiresAt).toISOString()
              : null,
          });
          await prisma.recordingSession.update({
            where: { id: existingSession.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
              finalizedAt: new Date(),
            },
          });
          const repoName = recordingSessionService.extractRepositoryName(existingSession.streamPath);
          await redis.del(streamRepoKey(repositoryId));
          await redis.del(streamPathKey(repoName));
          await redis.del(streamRecordingKey(existingSession.id));
          return;
        }

        const age = Date.now() - existingSession.createdAt.getTime();
        if (age > FIRST_PUBLISH_DEADLINE_MS) {
          console.info("[rtmp-register] pending-timeout-cleanup", {
            repositoryId,
            repositoryName,
            staleRecordingSessionId: existingSession.id,
            ageMs: age,
          });
          await prisma.recordingSession.update({
            where: { id: existingSession.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: "REGISTRATION_TIMEOUT",
              finalizedAt: new Date(),
            },
          });
          const repoName = recordingSessionService.extractRepositoryName(existingSession.streamPath);
          await redis.del(streamRepoKey(repositoryId));
          await redis.del(streamPathKey(repoName));
          await redis.del(streamRecordingKey(existingSession.id));
          return;
        }
      }

      if (
        existingSession.status === RecordingSessionStatus.STREAMING ||
        existingSession.status === RecordingSessionStatus.STOP_REQUESTED
      ) {
        const currentOwner = await streamOwnershipService.getCurrentOwnerForRepository(repositoryId);
        const ownerMatchesSession = currentOwner?.recordingSessionId === existingSession.id;
        const ownerIsStale = currentOwner ? streamOwnershipService.isStaleOwner(currentOwner) : true;
        const activePathPresent = activeRepoNames?.has(repositoryName) ?? false;

        if (!activePathPresent || !currentOwner || !ownerMatchesSession || ownerIsStale) {
          if (currentOwner && ownerMatchesSession) {
            const releaseResult = await streamOwnershipService.releaseConnectionLease({
              repositoryId,
              recordingSessionId: existingSession.id,
              connectionId: currentOwner.connectionId,
              generation: currentOwner.generation,
            });
            if (releaseResult.outcome === "released") {
              console.info("[rtmp-register] stale-owner-release-cleanup", {
                repositoryId,
                repositoryName,
                staleRecordingSessionId: existingSession.id,
                connectionId: currentOwner.connectionId,
                generation: currentOwner.generation,
                previousStatus: existingSession.status,
              });
            }
          }

          console.info("[rtmp-register] active-session-cleanup", {
            repositoryId,
            repositoryName,
            staleRecordingSessionId: existingSession.id,
            previousStatus: existingSession.status,
            activePathPresent,
            ownerRecordingSessionId: currentOwner?.recordingSessionId ?? null,
            ownerConnectionId: currentOwner?.connectionId ?? null,
            ownerGeneration: currentOwner?.generation ?? null,
            ownerStatus: currentOwner?.status ?? null,
          });

          await prisma.recordingSession.update({
            where: { id: existingSession.id },
            data: {
              status: RecordingSessionStatus.FINALIZING,
              notReadyAt: new Date(),
              ...(existingSession.endReason
                ? {}
                : { endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT }),
            },
          });
          await redis.del(streamRepoKey(repositoryId));
          await redis.del(streamPathKey(repositoryName));
          await redis.del(streamRecordingKey(existingSession.id));
          if (existingSession.sourceId) {
            await redis.del(`stream:source:${existingSession.sourceId}`);
          }
          await recordingSessionService.tryEnqueueFinalize(existingSession.id);
          return;
        }
      }

      console.warn("[rtmp-register] conflict-existing-session", {
        repositoryId,
        repositoryName,
        existingRecordingSessionId: existingSession.id,
        existingStatus: existingSession.status,
      });
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const [repoSessionId, pathSessionId] = await Promise.all([
      redis.get(streamRepoKey(repositoryId)),
      redis.get(streamPathKey(repositoryName)),
    ]);

    const staleIds = Array.from(new Set([repoSessionId, pathSessionId].filter((v): v is string => Boolean(v))));
    if (staleIds.length > 0) {
      console.info("[rtmp-register] cleared-stale-pointers", {
        repositoryId,
        repositoryName,
        staleRecordingSessionIds: staleIds,
      });
    }
    for (const staleId of staleIds) {
      await redis.del(streamRepoKey(repositoryId));
      await redis.del(streamPathKey(repositoryName));
      await redis.del(streamRecordingKey(staleId));
    }
  }

  /**
   * [MediaMTX active path 조회]
   * MediaMTX REST API(/v3/paths/list)를 호출하여 현재 실제로 송출 중인
   * repository 이름(live/{repoName} 에서 추출) 집합을 반환한다.
   * API 호출 실패 시 null을 반환하여 필터링을 건너뛰게 한다.
   */
  private async getActiveRepositoryNames(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const activeRepositoryNames = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }

        try {
          activeRepositoryNames.add(recordingSessionService.extractRepositoryName(item.name));
        } catch (_error) {
          // Ignore non-live paths.
        }
      }

      return activeRepositoryNames;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[streams] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }
}

export const streamService = new StreamService();
