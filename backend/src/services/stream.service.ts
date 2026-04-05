import { RecordingSessionStatus } from "@prisma/client";

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

const RECONCILE_INTERVAL_MS = 15 * 1000;

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
   * - RTMP publish URL(JWT 포함)을 반환하여 앱이 MediaMTX에 직접 연결할 수 있게 함
   */
  async registerSession(
    userId: string,
    userRole: AppUserRole,
    input: StreamRegisterInput,
    userJwt: string,
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

    const base = env.RTMP_BASE_URL.replace(/\/+$/, "");
    return {
      recording_session_id: session.id,
      repository_id: access.repository.id,
      repository_name: access.repository.name,
      rtmp_url: `${base}/${access.repository.name}?user=${encodeURIComponent(userId)}&pass=${encodeURIComponent(userJwt)}`,
      status: "ready" as const,
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
   * [RTMP publish 인증 시 세션 활성화]
   * publish 인증 성공 시 호출. PENDING 상태의 Redis live pointer TTL을
   * REGISTRATION_TTL(90초)에서 ACTIVE_TTL(24시간)로 연장한다.
   * 이를 통해 RTMP 연결이 실제로 수립되었음을 표시한다.
   */
  async activateSession(recordingSessionId: string): Promise<RecordingSessionLiveCache | null> {
    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return null;
    }

    let cache: RecordingSessionLiveCache;
    try {
      cache = JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return null;
    }

    if (cache.status === "FINALIZING") {
      return null;
    }

    await recordingSessionService.promoteLivePointerTtl(recordingSessionId);
    return cache;
  }

  /**
   * [상태 정합성 루프 시작]
   * 서버 기동 시 15초 간격으로 reconcileSessions를 실행하는 타이머를 시작한다.
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
        console.warn(`[streams] reconcile failed: ${message}`);
      });
    }, RECONCILE_INTERVAL_MS);

    this.reconcileTimer.unref();
  }

  /**
   * [등록 전 중복 검사]
   * 해당 repository에 이미 활성 스트림이 있는지 확인한다.
   * MediaMTX active path와 DB(PENDING/STREAMING/STOP_REQUESTED)를 모두 체크하고,
   * 90초 이상 지난 PENDING 세션은 ABORTED 처리하여 새 등록을 허용한다.
   * Redis에 남아있는 stale pointer도 정리한다.
   */
  private async ensureRepositoryPathIsAvailable(repositoryId: string, repositoryName: string) {
    const activeRepoNames = await this.getActiveRepositoryNames();
    if (activeRepoNames?.has(repositoryName)) {
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
        const age = Date.now() - existingSession.createdAt.getTime();
        if (age > 90 * 1000) {
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

      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const [repoSessionId, pathSessionId] = await Promise.all([
      redis.get(streamRepoKey(repositoryId)),
      redis.get(streamPathKey(repositoryName)),
    ]);

    const staleIds = Array.from(new Set([repoSessionId, pathSessionId].filter((v): v is string => Boolean(v))));
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
