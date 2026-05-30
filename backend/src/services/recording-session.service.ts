import { RecordingSessionStatus, RecordingSessionEndReason, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import {
  RECORDING_FINALIZE_GRACE_PERIOD_MS,
  RECORDING_FINALIZE_MAX_WAIT_MS,
  RECORDING_ACTIVE_TTL_SECONDS,
  RECORDING_REGISTRATION_TTL_SECONDS,
  SEGMENT_MAPPING_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../constants/stream/stream-constants";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { runtimeConfig as env } from "../config/runtime";
import { processingService } from "./processing.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamRecordingKey, streamSegmentKey } from "../utils/stream-keys";
import type {
  RecordingSessionLiveCache,
  RecordingFinalizeJobData,
  SegmentOwnershipMapping,
} from "../types/stream";
import type {
  StreamReadyHookInput,
  StreamNotReadyHookInput,
  SegmentCreateHookInput,
  SegmentCompleteHookInput,
} from "../schemas/stream.schema";

/**
 * RecordingSession 라이프사이클 전체를 관리하는 핵심 서비스.
 *
 * 상태 흐름:
 *   PENDING → STREAMING → STOP_REQUESTED → FINALIZING → COMPLETED/FAILED
 *   PENDING → ABORTED (타임아웃)
 *   STREAMING → FINALIZING (비정상 종료)
 *
 * Redis live/pending cache를 함께 관리하며,
 * MediaMTX hook 이벤트와 reconcile 루프를 통해 상태를 진행시킨다.
 */
export class RecordingSessionService {
  /**
   * [세션 생성 - PENDING]
   * stream 등록 시 호출. RecordingSession을 PENDING 상태로 DB에 생성하고,
   * Redis에 PENDING cache를 5분 TTL로 저장한다.
   * 5분 이내에 첫 RTMP publish가 시작되지 않으면 reconcile에서 ABORTED 처리된다.
   */
  async createSession(params: {
    id?: string;
    repositoryId: string;
    ownerId: string;
    userId: string;
    deviceType?: string;
    streamPath: string;
    targetDirectory: string;
  }) {
    const session = await prisma.recordingSession.create({
      data: {
        ...(params.id ? { id: params.id } : {}),
        repositoryId: params.repositoryId,
        ownerId: params.ownerId,
        userId: params.userId,
        deviceType: params.deviceType ?? null,
        streamPath: params.streamPath,
        status: RecordingSessionStatus.PENDING,
        targetDirectory: params.targetDirectory,
      },
    });

    await this.cachePendingSession(session, RECORDING_REGISTRATION_TTL_SECONDS);

    console.info("[rtmp-state] pending-created", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      ownerId: session.ownerId,
      userId: session.userId,
      deviceType: session.deviceType,
      streamPath: session.streamPath,
      registrationTtlSec: RECORDING_REGISTRATION_TTL_SECONDS,
    });

    return session;
  }

  async cachePendingSession(
    session: {
      id: string;
      repositoryId: string;
      userId: string;
      deviceType: string | null;
      streamPath: string;
    },
    ttlSeconds: number,
  ) {
    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      userId: session.userId,
      status: "PENDING",
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    await redis.set(
      streamRecordingKey(session.id),
      JSON.stringify(liveCache),
      "EX",
      Math.max(1, ttlSeconds),
    );

    console.info("[rtmp-state] pending-cache-refreshed", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: liveCache.repositoryName,
      userId: session.userId,
      ttlSec: ttlSeconds,
    });
  }

  /**
   * [stream-ready hook 처리 - PENDING → STREAMING]
   * MediaMTX가 실제 RTMP 송출 시작을 감지하면 호출.
   * 1. query의 publish ticket을 검증한다.
   * 2. ticket가 가리키는 PENDING 세션만 DB에서 조회한다.
   * 3. ticket를 consumed로 전환하면서 ticket TTL을 다시 60초로 연장한다.
   * 4. DB 상태를 갱신하고 Redis live cache 및 active set을 갱신한다.
   */
  async handleStreamReady(input: StreamReadyHookInput) {
    const publishTicketQuery = this.resolvePublishTicketQuery(input.query, input.ticket);
    const credentialSource = this.classifyTicketCredentialSource(input);
    const ticketValidation = await streamOwnershipService.validatePublishTicket(input.path, publishTicketQuery);
    if (!ticketValidation.ok) {
      console.warn("[rtmp-ticket] stream-ready-validation-rejected", {
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
        reason: ticketValidation.reason,
        ticketId: ticketValidation.ticketId,
        credentialSource,
        mtxQuery: input.mtx_query ?? null,
        mtxSourceId: input.mtx_source_id ?? null,
        mtxSourceType: input.mtx_source_type ?? null,
        mtxPath: input.mtx_path ?? null,
      });
      return;
    }

    const recordingSessionId = ticketValidation.ticket.recordingSessionId;
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session || session.status !== RecordingSessionStatus.PENDING) {
      console.warn("[rtmp-state] stream-ready-session-not-active", {
        recordingSessionId,
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
        status: session?.status ?? null,
      });
      return;
    }

    if (
      session.repositoryId !== ticketValidation.ticket.repositoryId ||
      session.userId !== ticketValidation.ticket.userId ||
      session.streamPath !== ticketValidation.ticket.streamPath
    ) {
      console.warn("[rtmp-ticket] stream-ready-session-metadata-mismatch", {
        recordingSessionId,
        sessionRepositoryId: session.repositoryId,
        ticketRepositoryId: ticketValidation.ticket.repositoryId,
        sessionUserId: session.userId,
        ticketUserId: ticketValidation.ticket.userId,
        sessionStreamPath: session.streamPath,
        ticketStreamPath: ticketValidation.ticket.streamPath,
        ticketId: ticketValidation.ticket.ticketId,
      });
      return;
    }

    const consumedTicket = await streamOwnershipService.consumePublishTicket(input.path, publishTicketQuery);
    if (!consumedTicket.ok) {
      console.warn("[rtmp-ticket] consume-rejected", {
        recordingSessionId,
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
        reason: consumedTicket.reason,
        ticketId: consumedTicket.ticketId,
      });
      return;
    }

    const repoName = this.extractRepositoryName(session.streamPath);
    const readyAt = session.readyAt ?? new Date();

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STREAMING,
        ...(session.readyAt ? {} : { readyAt }),
      },
    });

    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      userId: session.userId,
      status: "STREAMING",
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    await redis.multi()
      .set(
        streamRecordingKey(recordingSessionId),
        JSON.stringify(liveCache),
        "EX",
        RECORDING_ACTIVE_TTL_SECONDS,
      )
      .sadd(STREAM_ACTIVE_SET_KEY, recordingSessionId)
      .exec();

    console.info("[rtmp-ticket] consumed", {
      recordingSessionId: consumedTicket.ticket.recordingSessionId,
      repositoryId: consumedTicket.ticket.repositoryId,
      repositoryName: repoName,
      userId: consumedTicket.ticket.userId,
      ticketId: consumedTicket.ticket.ticketId,
      credentialSource,
    });

    console.info("[rtmp-state] pending-to-streaming", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      userId: session.userId,
      hookSourceId: input.source_id,
      sourceType: input.source_type,
    });
  }

  /**
   * [stream-not-ready hook 처리 - → FINALIZING]
   * MediaMTX가 RTMP 연결 종료를 감지하면 호출.
   * 1. stream path에서 recordingSessionId를 복원한다.
   * 2. 해당 세션을 FINALIZING으로 전환한다.
   * 3. path/session miss는 no-op + 경고 로그로 처리한다.
   */
  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    const recordingSessionId = this.extractRecordingSessionId(input.path);
    if (!recordingSessionId) {
      console.warn("[rtmp-state] stream-not-ready-path-invalid", {
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
      });
      return;
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      console.warn("[rtmp-state] stream-not-ready-session-missing", {
        recordingSessionId,
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
      });
      return;
    }

    if (
      session.status !== RecordingSessionStatus.STREAMING &&
      session.status !== RecordingSessionStatus.STOP_REQUESTED
    ) {
      console.warn("[rtmp-state] stream-not-ready-session-skipped", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        sourceId: input.source_id,
        sourceType: input.source_type,
        status: session.status,
      });
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
    await this.clearLivePointers(recordingSessionId, session.repositoryId, repoName);

    console.info("[rtmp-state] stream-to-finalizing", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      previousStatus: session.status,
      endReason,
      hookSourceId: input.source_id,
    });

    await this.tryEnqueueFinalize(recordingSessionId);
  }

  /**
   * [segment-create hook 처리]
   * MediaMTX가 새 녹화 세그먼트 파일 쓰기를 시작할 때 호출.
   * stream path의 recordingSessionId로 세션을 찾고, `segment:{segmentPath}` 매핑을 저장한 뒤
   * RecordingSegment를 WRITING 상태로 upsert한다.
   */
  async handleSegmentCreate(input: SegmentCreateHookInput) {
    const session = await this.resolveSegmentSession(input.path);
    if (!session) {
      console.warn("[rtmp-segment] session-missing", {
        path: input.path,
        sourceId: input.source_id ?? null,
        segmentPath: input.segment_path,
      });
      return;
    }

    const recordingSessionId = session.id;
    const segmentMapping: SegmentOwnershipMapping = {
      recordingSessionId,
      repositoryId: session.repositoryId,
      segmentPath: input.segment_path,
    };

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

    await redis.set(
      streamSegmentKey(input.segment_path),
      JSON.stringify(segmentMapping),
      "EX",
      SEGMENT_MAPPING_TTL_SECONDS,
    );

    console.info("[rtmp-segment] writing-created", {
      recordingSessionId,
      path: input.path,
      sourceId: input.source_id ?? null,
      segmentPath: input.segment_path,
      sequence: nextSequence,
    });
  }

  /**
   * [segment-complete hook 처리]
   * MediaMTX가 세그먼트 파일 쓰기를 완료하면 호출.
   * `segment:{segmentPath}` authoritative mapping만 사용하여 segment를 COMPLETED로 전환한다.
   * mapping miss는 no-op + 경고 로그로 처리한다.
   */
  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    let segmentMapping = await this.getSegmentMapping(input.segment_path);
    if (!segmentMapping) {
      const session = await this.resolveSegmentSession(input.path);
      if (session) {
        segmentMapping = {
          recordingSessionId: session.id,
          repositoryId: session.repositoryId,
          segmentPath: input.segment_path,
        };
      }
    }

    if (!segmentMapping) {
      console.warn("[rtmp-segment] mapping-missing", {
        path: input.path,
        sourceId: input.source_id ?? null,
        segmentPath: input.segment_path,
      });
      return;
    }

    const segment = await prisma.recordingSegment.findFirst({
      where: {
        rawPath: input.segment_path,
        recordingSessionId: segmentMapping.recordingSessionId,
      },
    });

    if (!segment) {
      const recordingSessionId = segmentMapping.recordingSessionId;

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

      console.info("[rtmp-segment] completed-created", {
        recordingSessionId,
        path: input.path,
        sourceId: input.source_id ?? null,
        segmentPath: input.segment_path,
        sequence: nextSequence,
        durationSec: input.segment_duration ?? null,
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

    console.info("[rtmp-segment] completed", {
      recordingSessionId: segment.recordingSessionId,
      path: input.path,
      sourceId: input.source_id ?? null,
      segmentPath: input.segment_path,
      sequence: segment.sequence,
      durationSec: input.segment_duration ?? null,
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
   * 이후 MediaMTX가 RTMP 연결 종료를 감지하면 stream-not-ready hook이 호출되어 FINALIZING으로 진행한다.
   */
  async requestStop(recordingSessionId: string, reason: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      throw NotFound("Recording session not found.");
    }

    if (
      session.status !== RecordingSessionStatus.PENDING &&
      session.status !== RecordingSessionStatus.STREAMING
    ) {
      throw Conflict(`Recording session is already in ${session.status} state.`);
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

    const cached = await this.getLiveCacheByRecordingSessionId(recordingSessionId);
    if (cached) {
      cached.status = "STOP_REQUESTED";
      await redis.set(
        streamRecordingKey(recordingSessionId),
        JSON.stringify(cached),
        "EX",
        RECORDING_ACTIVE_TTL_SECONDS,
      );
    }

    console.info("[rtmp-state] stop-requested", {
      recordingSessionId,
      repositoryId: updated.repositoryId,
      repositoryName: this.extractRepositoryName(updated.streamPath),
      userId: updated.userId,
      reason: endReason,
    });

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
      throw NotFound("Recording session not found.");
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
      throw NotFound("Recording session not found.");
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
      if (elapsedMs > RECORDING_FINALIZE_MAX_WAIT_MS) {
        await this.markSessionFailed(recordingSessionId, session.endReason);
        console.warn("[rtmp-finalize] failed-writing-segments-timeout", {
          recordingSessionId,
          repositoryId: session.repositoryId,
          repositoryName: this.extractRepositoryName(session.streamPath),
          elapsedMs,
          writingCount,
          endReason: session.endReason ?? null,
        });
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
      if (elapsedMs > RECORDING_FINALIZE_GRACE_PERIOD_MS) {
        if (
          session.endReason === RecordingSessionEndReason.USER_STOP ||
          session.endReason === RecordingSessionEndReason.GLASSES_STOP
        ) {
          await this.markSessionAborted(recordingSessionId, session.endReason);
          console.info("[rtmp-finalize] empty-session-aborted", {
            recordingSessionId,
            repositoryId: session.repositoryId,
            repositoryName: this.extractRepositoryName(session.streamPath),
            elapsedMs,
            completedCount,
            endReason: session.endReason,
          });
        } else {
          await this.markSessionFailed(recordingSessionId, session.endReason);
          console.warn("[rtmp-finalize] failed-missing-completed-segments", {
            recordingSessionId,
            repositoryId: session.repositoryId,
            repositoryName: this.extractRepositoryName(session.streamPath),
            elapsedMs,
            completedCount,
            endReason: session.endReason ?? null,
          });
        }
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
    console.info("[rtmp-finalize] enqueued", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      videoId: video.id,
      completedSegmentCount: completedCount,
      firstSegmentPath: firstSegment!.rawPath,
    });
    return true;
  }

  /**
   * [상태 정합성 보정 - reconcile]
   * 5초 간격으로 실행. hook 누락이나 비정상 종료로 인한 상태 불일치를 보정한다.
   * - FINALIZING: finalize enqueue 재시도
   * - PENDING: register timeout 시 ABORTED
   * - STREAMING/STOP_REQUESTED: active path가 없을 때 FINALIZING 전환 후 finalize 시도
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

    const activeStreamPaths = await this.getActiveStreamPaths();

    for (const session of activeSessions) {
      const repoName = this.extractRepositoryName(session.streamPath);

      if (session.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(session.id);
        continue;
      }

      if (session.status === RecordingSessionStatus.PENDING) {
        const age = Date.now() - this.getPendingRegistrationReferenceAt(session).getTime();
        if (age > RECORDING_REGISTRATION_TTL_SECONDS * 1000) {
          const aborted = await this.abortPendingSessionIfStillCurrent(
            session,
            RecordingSessionEndReason.REGISTRATION_TIMEOUT,
          );
          if (aborted) {
            await this.clearLivePointers(session.id, session.repositoryId, repoName);
            console.info("[rtmp-reconcile] pending-timeout-aborted", {
              recordingSessionId: session.id,
              repositoryId: session.repositoryId,
              repositoryName: repoName,
              ageMs: age,
              registrationTtlSec: RECORDING_REGISTRATION_TTL_SECONDS,
            });
          }
        }
        continue;
      }

      const activePathMissing = activeStreamPaths ? !activeStreamPaths.has(this.normalizeStreamPath(session.streamPath)) : false;
      const shouldFinalize = activePathMissing;

      if (shouldFinalize) {
        const reconcileReason = "missing-active-path-finalizing";
        await this.transitionSessionToFinalizing(session, reconcileReason, {
          repositoryName: repoName,
          activeStreamPaths: activeStreamPaths ? Array.from(activeStreamPaths.values()) : null,
        });
      }
    }
  }

  /**
   * [Live session 조회]
   * stream path에서 recordingSessionId를 추출하여 Redis live/pending cache를 조회한다.
   * RTMP/HLS/WHEP 인증에서 사용된다.
   */
  async getLiveCacheByPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    const recordingSessionId = this.extractRecordingSessionId(streamPath);
    if (!recordingSessionId) {
      return null;
    }

    return this.getLiveCacheByRecordingSessionId(recordingSessionId);
  }

  async getLiveCacheByRecordingSessionId(recordingSessionId: string): Promise<RecordingSessionLiveCache | null> {
    return this.parseRedisRecord<RecordingSessionLiveCache>(
      await redis.get(streamRecordingKey(recordingSessionId)),
    );
  }

  private async transitionSessionToFinalizing(
    session: {
      id: string;
      repositoryId: string;
      streamPath: string;
      status: RecordingSessionStatus;
      endReason: RecordingSessionEndReason | null;
    },
    reconcileReason: string,
    details: Record<string, unknown> = {},
  ) {
    await prisma.recordingSession.update({
      where: { id: session.id },
      data: {
        status: RecordingSessionStatus.FINALIZING,
        notReadyAt: new Date(),
        ...(session.endReason ? {} : { endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT }),
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    await this.clearLivePointers(session.id, session.repositoryId, repoName);

    console.info(`[rtmp-reconcile] ${reconcileReason}`, {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      previousStatus: session.status,
      ...details,
    });

    await this.tryEnqueueFinalize(session.id);
  }

  /**
   * [Redis live pointer 삭제]
   * 스트림 종료(not-ready) 또는 reconcile 시 호출.
   * active set 후보와 live/pending cache를 함께 제거한다.
   */
  private async clearLivePointers(
    recordingSessionId: string,
    repositoryId: string,
    repositoryName: string,
  ) {
    const recordingKey = streamRecordingKey(recordingSessionId);
    const results = await redis.multi()
      .del(recordingKey)
      .srem(STREAM_ACTIVE_SET_KEY, recordingSessionId)
      .exec();
    const deleted = Number(results?.[0]?.[1] ?? 0);
    const removed = Number(results?.[1]?.[1] ?? 0);

    if (deleted > 0 || removed > 0) {
      console.info("[rtmp-state] live-pointers-cleared", {
        recordingSessionId,
        repositoryId,
        repositoryName,
        recordingKey,
        activeSetKey: STREAM_ACTIVE_SET_KEY,
      });
    }
  }

  async getSegmentMapping(segmentPath: string): Promise<SegmentOwnershipMapping | null> {
    return this.parseRedisRecord<SegmentOwnershipMapping>(await redis.get(streamSegmentKey(segmentPath)));
  }

  private async resolveSegmentSession(streamPath: string) {
    const recordingSessionId = this.extractRecordingSessionId(streamPath);
    if (!recordingSessionId) {
      return null;
    }
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (
      !session ||
      (
        session.status !== RecordingSessionStatus.STREAMING &&
        session.status !== RecordingSessionStatus.STOP_REQUESTED &&
        session.status !== RecordingSessionStatus.FINALIZING
      )
    ) {
      return null;
    }
    return session;
  }

  /**
   * [stream path → repository 이름 추출]
   * "live/{repoName}/{recordingSessionId}" 형식의 stream path에서 repository 이름 부분을 추출한다.
   * 형식이 맞지 않으면 에러를 던진다.
   */
  extractRepositoryName(streamPath: string): string {
    const normalized = this.normalizeStreamPath(streamPath);
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      throw BadRequest("Invalid stream path format.");
    }
    return parts[1];
  }

  private extractRecordingSessionId(streamPath: string): string | null {
    const normalized = this.normalizeStreamPath(streamPath);
    const parts = normalized.split("/");
    if (parts.length < 3 || parts[0] !== "live" || !parts[2]) {
      return null;
    }
    return parts[2];
  }

  private normalizeStreamPath(streamPath: string): string {
    return streamPath.trim().replace(/^\/+|\/+$/g, "");
  }

  private getPendingRegistrationReferenceAt(session: { createdAt: Date; updatedAt?: Date | null }) {
    return session.updatedAt ?? session.createdAt;
  }

  private async abortPendingSessionIfStillCurrent(
    session: {
      id: string;
      createdAt: Date;
      updatedAt?: Date | null;
    },
    endReason: RecordingSessionEndReason,
  ) {
    const snapshotUpdatedAt = this.getPendingRegistrationReferenceAt(session);
    const result = await prisma.recordingSession.updateMany({
      where: {
        id: session.id,
        status: RecordingSessionStatus.PENDING,
        updatedAt: { lte: snapshotUpdatedAt },
      },
      data: {
        status: RecordingSessionStatus.ABORTED,
        endReason,
        finalizedAt: new Date(),
      },
    });

    return result.count > 0;
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

  private async markSessionAborted(
    recordingSessionId: string,
    endReason: RecordingSessionEndReason | null,
  ) {
    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.ABORTED,
        endReason,
        finalizedAt: new Date(),
      },
    });
  }

  /**
   * [MediaMTX active path 조회]
   * MediaMTX API에서 현재 active path 목록을 가져와 stream path 집합으로 반환한다.
   * reconcile 시 DB 상태와 대조하여 실제로 송출이 끊긴 세션을 감지하는 데 사용된다.
   */
  private async getActiveStreamPaths(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        console.warn("[rtmp-reconcile] active-path-query-failed", {
          reason: `status ${response.status}`,
        });
        return null;
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const paths = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }
        const normalized = this.normalizeStreamPath(item.name);
        const parts = normalized.split("/");
        if (parts.length >= 3 && parts[0] === "live" && parts[1] && parts[2]) {
          paths.add(normalized);
        }
      }

      return paths;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("[rtmp-reconcile] active-path-query-failed", {
        reason: message,
      });
      return null;
    }
  }

  private parseRedisRecord<T>(raw: string | null): T | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (_error) {
      return null;
    }
  }

  private resolvePublishTicketQuery(query?: string, ticket?: string) {
    if (query?.trim()) {
      return query;
    }

    if (!ticket?.trim()) {
      return undefined;
    }

    return new URLSearchParams({ ticket: ticket.trim() }).toString();
  }

  private classifyTicketCredentialSource(
    input: StreamReadyHookInput,
  ): "hook.query" | "hook.ticket" | "missing" {
    if (input.query?.trim()) {
      const params = new URLSearchParams(input.query);
      if (params.get("ticket")?.trim()) {
        return "hook.query";
      }
    }
    if (input.ticket?.trim()) {
      return "hook.ticket";
    }
    return "missing";
  }
}

export const recordingSessionService = new RecordingSessionService();
