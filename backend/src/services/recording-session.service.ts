import { RecordingSessionStatus, RecordingSessionEndReason, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { runtimeConfig as env } from "../config/runtime";
import { processingService } from "./processing.service";
import type {
  RecordingSessionLiveCache,
  RecordingFinalizeJobData,
} from "../types/stream";
import type {
  StreamReadyHookInput,
  StreamNotReadyHookInput,
  SegmentCreateHookInput,
  SegmentCompleteHookInput,
} from "../schemas/stream.schema";

const REGISTRATION_TTL_SECONDS = 90;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const FINALIZE_GRACE_PERIOD_MS = 30 * 1000;
const FINALIZE_MAX_WAIT_MS = 2 * 60 * 1000;

const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
const streamSourceKey = (sourceId: string) => `stream:source:${sourceId}`;
const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

/**
 * RecordingSession 라이프사이클 전체를 관리하는 핵심 서비스.
 *
 * 상태 흐름:
 *   PENDING → STREAMING → STOP_REQUESTED → FINALIZING → COMPLETED/FAILED
 *   PENDING → ABORTED (타임아웃)
 *   STREAMING → FINALIZING (비정상 종료)
 *
 * Redis live cache를 통해 실시간 세션 조회 성능을 확보하고,
 * MediaMTX hook 이벤트와 reconcile 루프를 통해 상태를 진행시킨다.
 */
export class RecordingSessionService {
  /**
   * [세션 생성 - PENDING]
   * stream 등록 시 호출. RecordingSession을 PENDING 상태로 DB에 생성하고,
   * Redis에 recording/repo/path 키를 90초 TTL로 저장한다.
   * 90초 이내에 RTMP publish가 시작되지 않으면 reconcile에서 ABORTED 처리된다.
   */
  async createSession(params: {
    repositoryId: string;
    ownerId: string;
    userId: string;
    deviceType?: string;
    streamPath: string;
    targetDirectory: string;
  }) {
    const session = await prisma.recordingSession.create({
      data: {
        repositoryId: params.repositoryId,
        ownerId: params.ownerId,
        userId: params.userId,
        deviceType: params.deviceType ?? null,
        streamPath: params.streamPath,
        status: RecordingSessionStatus.PENDING,
        targetDirectory: params.targetDirectory,
      },
    });

    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      ownerId: session.ownerId,
      userId: session.userId,
      targetDirectory: session.targetDirectory,
      status: "PENDING",
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    const repoName = liveCache.repositoryName;
    await redis
      .multi()
      .set(streamRecordingKey(session.id), JSON.stringify(liveCache), "EX", REGISTRATION_TTL_SECONDS)
      .set(streamRepoKey(session.repositoryId), session.id, "EX", REGISTRATION_TTL_SECONDS)
      .set(streamPathKey(repoName), session.id, "EX", REGISTRATION_TTL_SECONDS)
      .exec();

    return session;
  }

  /**
   * [stream-ready hook 처리 - PENDING → STREAMING]
   * MediaMTX가 실제 RTMP 송출 시작을 감지하면 호출.
   * 1. path(Redis) 또는 path+query(DB)로 PENDING 세션을 조회
   * 2. DB 상태를 STREAMING으로 전환, readyAt/sourceId/sourceType 기록
   * 3. Redis live cache를 24시간 TTL로 갱신하고 source pointer 추가
   */
  async handleStreamReady(input: StreamReadyHookInput) {
    const repoName = this.extractRepositoryName(input.path);
    const recordingSessionId = await this.resolveRecordingSessionIdForReady(input.path, input.query);
    if (!recordingSessionId) {
      console.warn(`[recording-session] stream-ready: no session found for path ${input.path}`);
      return;
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session || session.status !== RecordingSessionStatus.PENDING) {
      console.warn(`[recording-session] stream-ready: session ${recordingSessionId} not in PENDING state`);
      return;
    }

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STREAMING,
        readyAt: new Date(),
        sourceId: input.source_id,
        sourceType: input.source_type,
      },
    });

    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      ownerId: session.ownerId,
      userId: session.userId,
      targetDirectory: session.targetDirectory,
      status: "STREAMING",
      sourceId: input.source_id,
      sourceType: input.source_type,
      readyAt: new Date().toISOString(),
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    await redis
      .multi()
      .set(streamRecordingKey(recordingSessionId), JSON.stringify(liveCache), "EX", ACTIVE_TTL_SECONDS)
      .set(streamRepoKey(session.repositoryId), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamPathKey(repoName), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamSourceKey(input.source_id), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .exec();
  }

  /**
   * [stream-not-ready hook 처리 - → FINALIZING]
   * MediaMTX가 RTMP 연결 종료를 감지하면 호출.
   * 1. sourceId(Redis) → path(Redis) → DB 순으로 세션 조회
   * 2. STREAMING 또는 STOP_REQUESTED 상태일 때만 처리
   * 3. FINALIZING으로 전환, endReason 결정 (STOP_REQUESTED면 기존 reason 유지, 아니면 UNEXPECTED_DISCONNECT)
   * 4. Redis live pointer 삭제 후 finalize enqueue 시도
   */
  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    let recordingSessionId = await redis.get(streamSourceKey(input.source_id));
    if (!recordingSessionId) {
      const repoName = this.extractRepositoryName(input.path);
      recordingSessionId = await redis.get(streamPathKey(repoName));
    }
    if (!recordingSessionId) {
      const session = await prisma.recordingSession.findFirst({
        where: {
          streamPath: input.path,
          status: {
            in: [RecordingSessionStatus.STREAMING, RecordingSessionStatus.STOP_REQUESTED],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      recordingSessionId = session?.id ?? null;
    }
    if (!recordingSessionId) {
      console.warn(`[recording-session] stream-not-ready: no session found for path ${input.path}`);
      return;
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      console.warn(`[recording-session] stream-not-ready: session ${recordingSessionId} not found in DB`);
      return;
    }

    if (
      session.status !== RecordingSessionStatus.STREAMING &&
      session.status !== RecordingSessionStatus.STOP_REQUESTED
    ) {
      console.warn(
        `[recording-session] stream-not-ready: session ${recordingSessionId} in ${session.status}, skipping`,
      );
      return;
    }

    const endReason =
      session.status === RecordingSessionStatus.STOP_REQUESTED
        ? session.endReason
        : RecordingSessionEndReason.UNEXPECTED_DISCONNECT;

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.FINALIZING,
        notReadyAt: new Date(),
        ...(session.endReason ? {} : { endReason }),
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    await this.clearLivePointers(recordingSessionId, session.repositoryId, repoName, session.sourceId ?? undefined);

    await this.tryEnqueueFinalize(recordingSessionId);
  }

  /**
   * [segment-create hook 처리]
   * MediaMTX가 새 녹화 세그먼트 파일 쓰기를 시작할 때 호출.
   * stream path로 세션을 찾고, RecordingSegment를 WRITING 상태로 upsert한다.
   * sequence 번호는 기존 최대값 + 1로 자동 결정된다.
   */
  async handleSegmentCreate(input: SegmentCreateHookInput) {
    let recordingSessionId = await this.resolveRecordingSessionIdForSegment(input.path);
    if (!recordingSessionId) {
      console.warn(`[recording-session] segment-create: no session found for path ${input.path}`);
      return;
    }

    const maxSeq = await prisma.recordingSegment.aggregate({
      where: { recordingSessionId },
      _max: { sequence: true },
    });
    const nextSequence = (maxSeq._max.sequence ?? -1) + 1;

    await prisma.recordingSegment.upsert({
      where: {
        recordingSessionId_rawPath: {
          recordingSessionId,
          rawPath: input.segment_path,
        },
      },
      create: {
        recordingSessionId,
        sequence: nextSequence,
        rawPath: input.segment_path,
        status: RecordingSegmentStatus.WRITING,
      },
      update: {},
    });
  }

  /**
   * [segment-complete hook 처리]
   * MediaMTX가 세그먼트 파일 쓰기를 완료하면 호출.
   * segment를 COMPLETED로 전환하고 duration을 기록한다.
   * segment-create가 누락되었을 경우 여기서 직접 생성도 처리한다.
   * 세션이 이미 FINALIZING이면 finalize enqueue를 재시도한다.
   */
  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    const segment = await prisma.recordingSegment.findFirst({
      where: { rawPath: input.segment_path },
    });

    if (!segment) {
      const recordingSessionId = await this.resolveRecordingSessionIdForSegment(input.path);
      if (!recordingSessionId) {
        console.warn(`[recording-session] segment-complete: no session found for segment ${input.segment_path}`);
        return;
      }

      const maxSeq = await prisma.recordingSegment.aggregate({
        where: { recordingSessionId },
        _max: { sequence: true },
      });
      const nextSequence = (maxSeq._max.sequence ?? -1) + 1;

      await prisma.recordingSegment.create({
        data: {
          recordingSessionId,
          sequence: nextSequence,
          rawPath: input.segment_path,
          durationSec: input.segment_duration ?? null,
          status: RecordingSegmentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      const session = await prisma.recordingSession.findUnique({
        where: { id: recordingSessionId },
      });
      if (session?.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(recordingSessionId);
      }
      return;
    }

    await prisma.recordingSegment.update({
      where: { id: segment.id },
      data: {
        status: RecordingSegmentStatus.COMPLETED,
        durationSec: input.segment_duration ?? null,
        completedAt: new Date(),
      },
    });

    const session = await prisma.recordingSession.findUnique({
      where: { id: segment.recordingSessionId },
    });
    if (session?.status === RecordingSessionStatus.FINALIZING) {
      await this.tryEnqueueFinalize(segment.recordingSessionId);
    }
  }

  /**
   * [명시적 종료 요청 - → STOP_REQUESTED]
   * 앱에서 POST /api/v1/recordings/:id/stop 호출 시 진입.
   * PENDING 또는 STREAMING 상태의 세션을 STOP_REQUESTED로 전환하고,
   * endReason(USER_STOP/GLASSES_STOP)과 stopRequestedAt을 기록한다.
   * Redis live cache의 status도 갱신한다.
   * 이후 MediaMTX가 RTMP 연결 종료를 감지하면 stream-not-ready hook이 호출되어 FINALIZING으로 진행한다.
   */
  async requestStop(recordingSessionId: string, reason: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    if (
      session.status !== RecordingSessionStatus.PENDING &&
      session.status !== RecordingSessionStatus.STREAMING
    ) {
      throw new AppError(409, "CONFLICT", `Recording session is already in ${session.status} state.`);
    }

    const endReason = reason === "GLASSES_STOP"
      ? RecordingSessionEndReason.GLASSES_STOP
      : RecordingSessionEndReason.USER_STOP;

    const updated = await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STOP_REQUESTED,
        endReason,
        stopRequestedAt: new Date(),
      },
    });

    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (cachedStr) {
      try {
        const cached = JSON.parse(cachedStr) as RecordingSessionLiveCache;
        cached.status = "STOP_REQUESTED";
        cached.stopRequestedAt = new Date().toISOString();
        await redis.set(streamRecordingKey(recordingSessionId), JSON.stringify(cached), "EX", ACTIVE_TTL_SECONDS);
      } catch (_error) {
        // Ignore parse failures.
      }
    }

    return updated;
  }

  async getSessionStatus(recordingSessionId: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      include: {
        _count: { select: { segments: true } },
        video: { select: { id: true } },
      },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    return {
      id: session.id,
      status: session.status,
      end_reason: session.endReason,
      segment_count: session._count.segments,
      video_id: session.video?.id ?? null,
      created_at: session.createdAt.toISOString(),
      ready_at: session.readyAt?.toISOString() ?? null,
      not_ready_at: session.notReadyAt?.toISOString() ?? null,
      finalized_at: session.finalizedAt?.toISOString() ?? null,
    };
  }

  async getSessionRepositoryId(recordingSessionId: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      select: { repositoryId: true },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    return session.repositoryId;
  }

  /**
   * [finalize job enqueue 시도]
   * FINALIZING 상태에서 실제 후처리 작업을 BullMQ 큐에 넣을 수 있는지 판단한다.
   * 판단 순서:
   * 1. WRITING 세그먼트가 남아있으면 대기 (max wait 초과 시 FAILED)
   * 2. COMPLETED 세그먼트가 없으면 대기 (grace period 초과 시 FAILED)
   * 3. 모든 조건 충족 시: Video 레코드를 PENDING으로 upsert하고, finalize job을 enqueue
   * stream-not-ready, reconcile, segment-complete에서 반복 호출될 수 있다.
   */
  async tryEnqueueFinalize(recordingSessionId: string): Promise<boolean> {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      include: {
        video: { select: { id: true } },
      },
    });
    if (!session || session.status !== RecordingSessionStatus.FINALIZING) {
      return false;
    }

    const writingCount = await prisma.recordingSegment.count({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.WRITING,
      },
    });

    const finalizeReferenceAt = this.getFinalizeReferenceAt(session);
    const elapsedMs = Date.now() - finalizeReferenceAt.getTime();

    if (writingCount > 0) {
      if (elapsedMs > FINALIZE_MAX_WAIT_MS) {
        await this.markSessionFailed(recordingSessionId, session.endReason);
        console.warn(
          `[recording-session] tryEnqueueFinalize: session ${recordingSessionId} failed — writing segments remained for ${elapsedMs}ms`,
        );
      }
      return false;
    }

    const completedCount = await prisma.recordingSegment.count({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.COMPLETED,
      },
    });

    if (completedCount === 0) {
      if (elapsedMs > FINALIZE_GRACE_PERIOD_MS) {
        await this.markSessionFailed(recordingSessionId, session.endReason);
        console.warn(
          `[recording-session] tryEnqueueFinalize: session ${recordingSessionId} failed — no completed segments after ${elapsedMs}ms`,
        );
      }
      return false;
    }

    const firstSegment = await prisma.recordingSegment.findFirst({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.COMPLETED,
      },
      orderBy: { sequence: "asc" },
    });

    const video = await prisma.video.upsert({
      where: { recordingSessionId: session.id },
      update: {
        rawRecordingPath: firstSegment!.rawPath,
        streamPath: session.streamPath,
        deviceType: session.deviceType,
        ...(session.video ? {} : { status: VideoStatus.PENDING, errorMessage: null }),
      },
      create: {
        repositoryId: session.repositoryId,
        recordingSessionId: session.id,
        rawRecordingPath: firstSegment!.rawPath,
        streamPath: session.streamPath,
        deviceType: session.deviceType,
        status: VideoStatus.PENDING,
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    const payload: RecordingFinalizeJobData = {
      recordingSessionId: session.id,
      videoId: video.id,
      repositoryId: session.repositoryId,
      ownerId: session.ownerId,
      repoName,
      targetDirectory: session.targetDirectory,
    };

    await processingService.enqueueRecordingFinalize(payload);
    return true;
  }

  /**
   * [상태 정합성 보정 - reconcile]
   * 15초 간격으로 실행. hook 누락이나 비정상 종료로 인한 상태 불일치를 보정한다.
   * - FINALIZING: finalize enqueue 재시도
   * - PENDING: 90초 초과 시 ABORTED + REGISTRATION_TIMEOUT
   * - STREAMING/STOP_REQUESTED: MediaMTX에 해당 path가 없으면 FINALIZING 전환 후 finalize 시도
   */
  async reconcileSessions() {
    const activeSessions = await prisma.recordingSession.findMany({
      where: {
        status: {
          in: [
            RecordingSessionStatus.PENDING,
            RecordingSessionStatus.STREAMING,
            RecordingSessionStatus.STOP_REQUESTED,
            RecordingSessionStatus.FINALIZING,
          ],
        },
      },
    });

    if (activeSessions.length === 0) {
      return;
    }

    const activeRepoNames = await this.getActiveRepositoryNames();
    const now = Date.now();

    for (const session of activeSessions) {
      const repoName = this.extractRepositoryName(session.streamPath);

      if (session.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(session.id);
        continue;
      }

      if (session.status === RecordingSessionStatus.PENDING) {
        const age = now - session.createdAt.getTime();
        if (age > REGISTRATION_TTL_SECONDS * 1000) {
          await prisma.recordingSession.update({
            where: { id: session.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: RecordingSessionEndReason.REGISTRATION_TIMEOUT,
              finalizedAt: new Date(),
            },
          });
          await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);
        }
        continue;
      }

      if (activeRepoNames && !activeRepoNames.has(repoName)) {
        await prisma.recordingSession.update({
          where: { id: session.id },
          data: {
            status: RecordingSessionStatus.FINALIZING,
            notReadyAt: new Date(),
            ...(session.endReason ? {} : { endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT }),
          },
        });
        await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);
        await this.tryEnqueueFinalize(session.id);
      }
    }
  }

  /**
   * [Redis live cache 조회]
   * stream path에서 repository 이름을 추출하여 Redis path pointer → recording cache 순으로 조회.
   * RTMP 인증(auth.service) 시 활성 세션 존재 여부를 빠르게 확인하는 데 사용된다.
   */
  async getLiveCacheByPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    const repoName = this.extractRepositoryName(streamPath);
    const recordingSessionId = await redis.get(streamPathKey(repoName));
    if (!recordingSessionId) {
      return null;
    }

    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return null;
    }

    try {
      return JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return null;
    }
  }

  /**
   * [Redis live pointer TTL 연장]
   * RTMP publish 인증 성공 시 호출. recording/repo/path/source 키의 TTL을
   * 24시간으로 연장하여 활성 세션이 만료되지 않게 한다.
   */
  async promoteLivePointerTtl(recordingSessionId: string) {
    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return;
    }

    let cache: RecordingSessionLiveCache;
    try {
      cache = JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return;
    }

    const repoName = cache.repositoryName;
    const pipeline = redis.multi();
    pipeline.expire(streamRecordingKey(recordingSessionId), ACTIVE_TTL_SECONDS);
    pipeline.expire(streamRepoKey(cache.repositoryId), ACTIVE_TTL_SECONDS);
    pipeline.expire(streamPathKey(repoName), ACTIVE_TTL_SECONDS);
    if (cache.sourceId) {
      pipeline.expire(streamSourceKey(cache.sourceId), ACTIVE_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  /**
   * [Redis live pointer 삭제]
   * 스트림 종료(not-ready) 또는 reconcile 시 호출.
   * repo/path/recording/source 키를 삭제하여 해당 세션의 live 상태를 해제한다.
   * 다른 세션이 같은 키를 사용 중이면 해당 키는 삭제하지 않는다.
   */
  private async clearLivePointers(
    recordingSessionId: string,
    repositoryId: string,
    repositoryName: string,
    sourceId?: string,
  ) {
    const keys = [
      streamRepoKey(repositoryId),
      streamPathKey(repositoryName),
      streamRecordingKey(recordingSessionId),
    ];
    if (sourceId) {
      keys.push(streamSourceKey(sourceId));
    }

    for (const key of keys) {
      const value = await redis.get(key);
      if (value === recordingSessionId) {
        await redis.del(key);
      } else if (key === streamRecordingKey(recordingSessionId)) {
        await redis.del(key);
      }
    }
  }

  /**
   * [stream path → repository 이름 추출]
   * "live/{repoName}" 형식의 stream path에서 repository 이름 부분을 추출한다.
   * 형식이 맞지 않으면 에러를 던진다.
   */
  extractRepositoryName(streamPath: string): string {
    const normalized = streamPath.trim().replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream path format.");
    }
    return parts[1];
  }

  /**
   * [segment hook용 세션 ID 조회]
   * Redis path pointer를 먼저 확인하고, 없으면 DB에서
   * FINALIZING/STOP_REQUESTED/STREAMING 상태의 최신 세션을 조회한다.
   */
  private async resolveRecordingSessionIdForSegment(streamPath: string) {
    const repoName = this.extractRepositoryName(streamPath);
    const liveRecordingSessionId = await redis.get(streamPathKey(repoName));
    if (liveRecordingSessionId) {
      return liveRecordingSessionId;
    }

    const session = await prisma.recordingSession.findFirst({
      where: {
        streamPath,
        status: {
          in: [
            RecordingSessionStatus.FINALIZING,
            RecordingSessionStatus.STOP_REQUESTED,
            RecordingSessionStatus.STREAMING,
          ],
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });

    return session?.id ?? null;
  }

  /**
   * [stream-ready hook용 세션 ID 조회]
   * Redis path pointer를 먼저 확인하고, 없으면 DB에서 PENDING 상태의 세션을 조회한다.
   * query에 user 파라미터가 있으면 해당 사용자의 세션만 조회한다.
   */
  private async resolveRecordingSessionIdForReady(streamPath: string, query?: string) {
    const repoName = this.extractRepositoryName(streamPath);
    const liveRecordingSessionId = await redis.get(streamPathKey(repoName));
    if (liveRecordingSessionId) {
      return liveRecordingSessionId;
    }

    const queryParams = new URLSearchParams(query ?? "");
    const requestedUserId = queryParams.get("user");
    const session = await prisma.recordingSession.findFirst({
      where: {
        streamPath,
        status: RecordingSessionStatus.PENDING,
        ...(requestedUserId ? { userId: requestedUserId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });

    return session?.id ?? null;
  }

  private getFinalizeReferenceAt(session: {
    notReadyAt: Date | null;
    stopRequestedAt: Date | null;
    readyAt: Date | null;
    createdAt: Date;
  }) {
    return session.notReadyAt ?? session.stopRequestedAt ?? session.readyAt ?? session.createdAt;
  }

  /**
   * [세션 실패 처리]
   * segment 대기 타임아웃 등으로 finalize를 진행할 수 없을 때 호출.
   * RecordingSession을 FAILED 상태로 전환하고 finalizedAt을 기록한다.
   */
  private async markSessionFailed(
    recordingSessionId: string,
    endReason: RecordingSessionEndReason | null,
  ) {
    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.FAILED,
        endReason: endReason ?? RecordingSessionEndReason.INTERNAL_ERROR,
        finalizedAt: new Date(),
      },
    });
  }

  /**
   * [MediaMTX active path 조회]
   * MediaMTX API에서 현재 active path 목록을 가져와 repository 이름 집합으로 반환한다.
   * reconcile 시 DB 상태와 대조하여 실제로 송출이 끊긴 세션을 감지하는 데 사용된다.
   */
  private async getActiveRepositoryNames(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const names = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }
        try {
          names.add(this.extractRepositoryName(item.name));
        } catch (_error) {
          // Ignore non-live paths.
        }
      }

      return names;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[recording-session] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }
}

export const recordingSessionService = new RecordingSessionService();
