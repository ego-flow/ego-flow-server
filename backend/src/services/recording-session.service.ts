import { RecordingSessionStatus, RecordingSessionEndReason, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { runtimeConfig as env } from "../config/runtime";
import { processingService } from "./processing.service";
import { streamOwnershipService } from "./stream-ownership.service";
import type {
  RecordingSessionLiveCache,
  RecordingFinalizeJobData,
  SegmentOwnershipMapping,
  StreamSourceMapping,
} from "../types/stream";
import type {
  StreamReadyHookInput,
  StreamNotReadyHookInput,
  SegmentCreateHookInput,
  SegmentCompleteHookInput,
} from "../schemas/stream.schema";

const REGISTRATION_TTL_SECONDS = 5 * 60;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const FINALIZE_GRACE_PERIOD_MS = 30 * 1000;
const FINALIZE_MAX_WAIT_MS = 2 * 60 * 1000;

const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
const streamSourceKey = (sourceId: string) => `stream:source:${sourceId}`;
const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;
const streamSegmentKey = (segmentPath: string) => `segment:${segmentPath}`;
const SEGMENT_MAPPING_TTL_SECONDS = 24 * 60 * 60;

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
   * Redis에 recording/repo/path 키를 5분 TTL로 저장한다.
   * 5분 이내에 첫 RTMP publish가 시작되지 않으면 reconcile에서 ABORTED 처리된다.
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

    console.info("[rtmp-state] pending-created", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      ownerId: session.ownerId,
      userId: session.userId,
      deviceType: session.deviceType,
      streamPath: session.streamPath,
      registrationTtlSec: REGISTRATION_TTL_SECONDS,
    });

    return session;
  }

  /**
   * [stream-ready hook 처리 - PENDING/STREAMING → STREAMING]
   * MediaMTX가 실제 RTMP 송출 시작을 감지하면 호출.
   * 1. query의 publish ticket와 현재 owner/connection lease를 먼저 검증한다.
   * 2. ticket가 가리키는 PENDING 또는 같은 STREAMING 세션만 DB에서 조회한다.
   * 3. ticket를 consumed로 전환한 뒤 owner refresh가 성공할 때만 DB/Redis를 갱신한다.
   * 4. Redis live cache를 24시간 TTL로 갱신하고 reconnect면 이전 source pointer를 교체한다.
   */
  async handleStreamReady(input: StreamReadyHookInput) {
    const ticketValidation = await streamOwnershipService.validatePublishTicket(input.path, input.query);
    if (!ticketValidation.ok) {
      console.warn("[rtmp-ticket] stream-ready-validation-rejected", {
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
        reason: ticketValidation.reason,
        ticketId: ticketValidation.ticketId,
      });
      return;
    }

    const recordingSessionId = ticketValidation.ticket.recordingSessionId;
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (
      !session ||
      (session.status !== RecordingSessionStatus.PENDING &&
        session.status !== RecordingSessionStatus.STREAMING)
    ) {
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

    const consumedTicket = await streamOwnershipService.consumePublishTicket(input.path, input.query);
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

    const repoName = ticketValidation.ticket.repositoryName;
    const existingLiveCache = await this.getLiveCacheByRecordingSessionId(recordingSessionId);
    const ownerRefresh = await streamOwnershipService.refreshConnectionLease({
      repositoryId: session.repositoryId,
      recordingSessionId,
      connectionId: consumedTicket.ticket.connectionId,
      generation: consumedTicket.ticket.generation,
      sourceId: input.source_id,
      sourceType: input.source_type,
    });

    if (ownerRefresh.outcome === "rejected") {
      console.warn("[rtmp-owner] stream-ready-publishing-refresh-rejected", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: repoName,
        connectionId: consumedTicket.ticket.connectionId,
        generation: consumedTicket.ticket.generation,
        reason: ownerRefresh.reason,
        sourceId: input.source_id,
        sourceType: input.source_type,
      });
      return;
    }

    const readyAt = session.readyAt ?? new Date();
    const previousSourceId = existingLiveCache?.sourceId ?? session.sourceId ?? undefined;
    const sourceMapping: StreamSourceMapping = {
      recordingSessionId,
      repositoryId: session.repositoryId,
      connectionId: consumedTicket.ticket.connectionId,
      generation: consumedTicket.ticket.generation,
      sourceId: input.source_id,
      sourceType: input.source_type,
    };

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STREAMING,
        ...(session.readyAt ? {} : { readyAt }),
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
      ...(existingLiveCache?.publishTicketIssuedAt
        ? { publishTicketIssuedAt: existingLiveCache.publishTicketIssuedAt }
        : {}),
      readyAt: readyAt.toISOString(),
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    const pipeline = redis
      .multi()
      .set(streamRecordingKey(recordingSessionId), JSON.stringify(liveCache), "EX", ACTIVE_TTL_SECONDS)
      .set(streamRepoKey(session.repositoryId), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamPathKey(repoName), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamSourceKey(input.source_id), JSON.stringify(sourceMapping), "EX", ACTIVE_TTL_SECONDS);

    if (previousSourceId && previousSourceId !== input.source_id) {
      pipeline.del(streamSourceKey(previousSourceId));
    }

    await pipeline.exec();

    console.info("[rtmp-ticket] consumed", {
      recordingSessionId: consumedTicket.ticket.recordingSessionId,
      repositoryId: consumedTicket.ticket.repositoryId,
      repositoryName: consumedTicket.ticket.repositoryName,
      userId: consumedTicket.ticket.userId,
      ticketId: consumedTicket.ticket.ticketId,
      connectionId: consumedTicket.ticket.connectionId,
      generation: consumedTicket.ticket.generation,
    });

    console.info(
      session.status === RecordingSessionStatus.PENDING
        ? "[rtmp-state] pending-to-streaming"
        : "[rtmp-state] streaming-source-refreshed",
      {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: repoName,
        userId: session.userId,
        previousSourceId: previousSourceId ?? null,
        sourceId: input.source_id,
        sourceType: input.source_type,
        connectionId: consumedTicket.ticket.connectionId,
        generation: consumedTicket.ticket.generation,
        activeTtlSec: ACTIVE_TTL_SECONDS,
      },
    );
  }

  /**
   * [stream-not-ready hook 처리 - → FINALIZING]
   * MediaMTX가 RTMP 연결 종료를 감지하면 호출.
   * 1. `stream:source:{sourceId}` authoritative mapping으로 connection/generation/session을 복원한다.
   * 2. generation match release가 성공한 경우에만 해당 세션을 FINALIZING으로 전환한다.
   * 3. mapping miss 또는 generation mismatch는 no-op + 경고 로그로 처리한다.
   */
  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    const sourceMapping = await this.getSourceMapping(input.source_id);
    if (!sourceMapping) {
      console.warn("[rtmp-state] stream-not-ready-source-mapping-missing", {
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
      });
      return;
    }

    const recordingSessionId = sourceMapping.recordingSessionId;
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      console.warn("[rtmp-state] stream-not-ready-session-missing", {
        recordingSessionId,
        path: input.path,
        sourceId: input.source_id,
        sourceType: input.source_type,
        connectionId: sourceMapping.connectionId,
        generation: sourceMapping.generation,
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
        connectionId: sourceMapping.connectionId,
        generation: sourceMapping.generation,
        status: session.status,
      });
      return;
    }

    const releaseResult = await streamOwnershipService.releaseConnectionLease({
      repositoryId: session.repositoryId,
      recordingSessionId: sourceMapping.recordingSessionId,
      connectionId: sourceMapping.connectionId,
      generation: sourceMapping.generation,
    });

    if (releaseResult.outcome !== "released") {
      console.warn("[rtmp-owner] generation-mismatch", {
        recordingSessionId: sourceMapping.recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        sourceId: input.source_id,
        sourceType: input.source_type,
        connectionId: sourceMapping.connectionId,
        generation: sourceMapping.generation,
        reason: releaseResult.reason,
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
    await this.clearLivePointers(recordingSessionId, session.repositoryId, repoName, session.sourceId ?? undefined);

    console.info("[rtmp-state] stream-to-finalizing", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      previousStatus: session.status,
      endReason,
      sourceId: session.sourceId,
      hookSourceId: input.source_id,
      connectionId: sourceMapping.connectionId,
      generation: sourceMapping.generation,
    });

    await this.tryEnqueueFinalize(recordingSessionId);
  }

  /**
   * [segment-create hook 처리]
   * MediaMTX가 새 녹화 세그먼트 파일 쓰기를 시작할 때 호출.
   * authoritative source mapping으로 세션을 찾고, `segment:{segmentPath}` 매핑을 저장한 뒤
   * RecordingSegment를 WRITING 상태로 upsert한다.
   */
  async handleSegmentCreate(input: SegmentCreateHookInput) {
    const sourceMapping = await this.resolveSegmentSourceMapping(input.path, input.source_id);
    if (!sourceMapping) {
      console.warn("[rtmp-segment] source-mapping-missing", {
        path: input.path,
        sourceId: input.source_id ?? null,
        segmentPath: input.segment_path,
      });
      return;
    }

    const recordingSessionId = sourceMapping.recordingSessionId;
    const segmentMapping: SegmentOwnershipMapping = {
      recordingSessionId,
      repositoryId: sourceMapping.repositoryId,
      connectionId: sourceMapping.connectionId,
      generation: sourceMapping.generation,
      sourceId: sourceMapping.sourceId,
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
      sourceId: sourceMapping.sourceId ?? input.source_id ?? null,
      segmentPath: input.segment_path,
      connectionId: sourceMapping.connectionId,
      generation: sourceMapping.generation,
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
      const sourceMapping = await this.resolveSegmentSourceMapping(input.path, input.source_id);
      if (sourceMapping) {
        segmentMapping = {
          recordingSessionId: sourceMapping.recordingSessionId,
          repositoryId: sourceMapping.repositoryId,
          connectionId: sourceMapping.connectionId,
          generation: sourceMapping.generation,
          sourceId: sourceMapping.sourceId,
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
        sourceId: input.source_id ?? segmentMapping.sourceId ?? null,
        segmentPath: input.segment_path,
        connectionId: segmentMapping.connectionId,
        generation: segmentMapping.generation,
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
      sourceId: input.source_id ?? segmentMapping.sourceId ?? null,
      segmentPath: input.segment_path,
      connectionId: segmentMapping.connectionId,
      generation: segmentMapping.generation,
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
      if (elapsedMs > FINALIZE_GRACE_PERIOD_MS) {
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
   * - PENDING: register timeout 또는 claimed owner lease 만료 시 ABORTED
   * - STREAMING/STOP_REQUESTED: owner lease stale, owner mismatch, active path 없음일 때 FINALIZING 전환 후 finalize 시도
   * - orphan connection metadata: current owner와 연결되지 않은 conn:* key 정리
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

    const now = Date.now();
    if (activeSessions.length === 0) {
      await this.cleanupOrphanConnections([], now);
      return;
    }

    const activeRepoNames = await this.getActiveRepositoryNames();

    for (const session of activeSessions) {
      const repoName = this.extractRepositoryName(session.streamPath);

      if (session.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(session.id);
        continue;
      }

      let currentOwner = await streamOwnershipService.getCurrentOwnerForRepository(session.repositoryId);
      let ownerMatchesSession = currentOwner?.recordingSessionId === session.id;
      let ownerIsStale = currentOwner ? streamOwnershipService.isStaleOwner(currentOwner, now) : true;

      if (session.status === RecordingSessionStatus.PENDING) {
        const liveCache = await this.getLiveCacheByRecordingSessionId(session.id);
        const publishTicketIssuedAtMs = liveCache?.publishTicketIssuedAt
          ? Date.parse(liveCache.publishTicketIssuedAt)
          : Number.NaN;
        const hasPublishTicketIssuedAt = Number.isFinite(publishTicketIssuedAtMs);

        if (
          hasPublishTicketIssuedAt &&
          (!currentOwner || !ownerMatchesSession || ownerIsStale)
        ) {
          await prisma.recordingSession.update({
            where: { id: session.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
              finalizedAt: new Date(),
            },
          });
          await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);
          console.info("[rtmp-reconcile] pending-claimed-owner-missing-or-stale", {
            recordingSessionId: session.id,
            repositoryId: session.repositoryId,
            repositoryName: repoName,
            publishTicketIssuedAt: liveCache?.publishTicketIssuedAt ?? null,
            ownerConnectionId: currentOwner?.connectionId ?? null,
            ownerGeneration: currentOwner?.generation ?? null,
            ownerLeaseExpiresAt: currentOwner ? new Date(currentOwner.leaseExpiresAt).toISOString() : null,
          });
          continue;
        }

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
          console.info("[rtmp-reconcile] pending-timeout-aborted", {
            recordingSessionId: session.id,
            repositoryId: session.repositoryId,
            repositoryName: repoName,
            ageMs: age,
            registrationTtlSec: REGISTRATION_TTL_SECONDS,
          });
        }
        continue;
      }

      if (currentOwner && ownerMatchesSession && (session.status === RecordingSessionStatus.STOP_REQUESTED || ownerIsStale)) {
        const releaseReason =
          session.status === RecordingSessionStatus.STOP_REQUESTED
            ? "stop-requested-owner-cleanup"
            : "stale-owner-cleanup";
        const releaseResult = await streamOwnershipService.releaseConnectionLease({
          repositoryId: session.repositoryId,
          recordingSessionId: session.id,
          connectionId: currentOwner.connectionId,
          generation: currentOwner.generation,
        });

        if (releaseResult.outcome === "released") {
          console.info(`[rtmp-reconcile] ${releaseReason}`, {
            recordingSessionId: session.id,
            repositoryId: session.repositoryId,
            repositoryName: repoName,
            connectionId: currentOwner.connectionId,
            generation: currentOwner.generation,
            previousStatus: session.status,
            ownerLeaseExpired: currentOwner.leaseExpiresAt <= now,
          });
          currentOwner = null;
          ownerMatchesSession = false;
          ownerIsStale = true;
        } else {
          console.warn("[rtmp-owner] generation-mismatch", {
            recordingSessionId: session.id,
            repositoryId: session.repositoryId,
            repositoryName: repoName,
            connectionId: currentOwner.connectionId,
            generation: currentOwner.generation,
            previousStatus: session.status,
            reason: releaseResult.reason,
          });
          currentOwner = await streamOwnershipService.getCurrentOwnerForRepository(session.repositoryId);
          ownerMatchesSession = currentOwner?.recordingSessionId === session.id;
          ownerIsStale = currentOwner ? streamOwnershipService.isStaleOwner(currentOwner, now) : true;
        }
      }

      const activePathMissing = activeRepoNames ? !activeRepoNames.has(repoName) : false;
      const sourceMappingPresent = session.sourceId ? Boolean(await this.getSourceMapping(session.sourceId)) : false;
      const missingOrForeignOwner = !currentOwner || !ownerMatchesSession;
      const shouldFinalize =
        activePathMissing ||
        missingOrForeignOwner ||
        !sourceMappingPresent ||
        ownerIsStale;

      if (shouldFinalize) {
        if (currentOwner && ownerMatchesSession) {
          const releaseResult = await streamOwnershipService.releaseConnectionLease({
            repositoryId: session.repositoryId,
            recordingSessionId: session.id,
            connectionId: currentOwner.connectionId,
            generation: currentOwner.generation,
          });

          if (releaseResult.outcome === "released") {
            console.info("[rtmp-reconcile] finalize-owner-release", {
              recordingSessionId: session.id,
              repositoryId: session.repositoryId,
              repositoryName: repoName,
              connectionId: currentOwner.connectionId,
              generation: currentOwner.generation,
              previousStatus: session.status,
            });
            currentOwner = null;
            ownerMatchesSession = false;
            ownerIsStale = true;
          } else {
            console.warn("[rtmp-owner] generation-mismatch", {
              recordingSessionId: session.id,
              repositoryId: session.repositoryId,
              repositoryName: repoName,
              connectionId: currentOwner.connectionId,
              generation: currentOwner.generation,
              previousStatus: session.status,
              reason: releaseResult.reason,
            });
            currentOwner = await streamOwnershipService.getCurrentOwnerForRepository(session.repositoryId);
            ownerMatchesSession = currentOwner?.recordingSessionId === session.id;
            ownerIsStale = currentOwner ? streamOwnershipService.isStaleOwner(currentOwner, now) : true;

            if (currentOwner && ownerMatchesSession && !ownerIsStale) {
              console.info("[rtmp-reconcile] finalize-deferred-owner-still-attached", {
                recordingSessionId: session.id,
                repositoryId: session.repositoryId,
                repositoryName: repoName,
                connectionId: currentOwner.connectionId,
                generation: currentOwner.generation,
                previousStatus: session.status,
              });
              continue;
            }
          }
        }

        const reconcileReason = activePathMissing
          ? "missing-active-path-finalizing"
          : !sourceMappingPresent
            ? "missing-source-mapping-finalizing"
            : missingOrForeignOwner
            ? "owner-mismatch-finalizing"
            : "stale-owner-finalizing";
        await this.transitionSessionToFinalizing(session, reconcileReason, {
          repositoryName: repoName,
          activeRepoNames: activeRepoNames ? Array.from(activeRepoNames.values()) : null,
          ownerConnectionId: currentOwner?.connectionId ?? null,
          ownerGeneration: currentOwner?.generation ?? null,
          ownerStatus: currentOwner?.status ?? null,
          ownerLeaseExpiresAt: currentOwner ? new Date(currentOwner.leaseExpiresAt).toISOString() : null,
          ownerLastHeartbeatAt: currentOwner ? new Date(currentOwner.lastHeartbeatAt).toISOString() : null,
          sourceMappingPresent,
        });
      }
    }

    await this.cleanupOrphanConnections(activeSessions, now);
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

    return this.getLiveCacheByRecordingSessionId(recordingSessionId);
  }

  async getLiveCacheByRecordingSessionId(recordingSessionId: string): Promise<RecordingSessionLiveCache | null> {
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
   * [publish ticket 발급 시각 기록]
   * PENDING 세션에서 첫 publish attempt 정합성 판단을 위해 live cache에 마지막 ticket 발급 시각을 남긴다.
   */
  async markPublishTicketIssued(recordingSessionId: string) {
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
    const ttlSeconds = cache.status === "PENDING" ? REGISTRATION_TTL_SECONDS : ACTIVE_TTL_SECONDS;
    const nextCache: RecordingSessionLiveCache = {
      ...cache,
      publishTicketIssuedAt: new Date().toISOString(),
    };
    const pipeline = redis.multi();
    pipeline.set(streamRecordingKey(recordingSessionId), JSON.stringify(nextCache), "EX", ttlSeconds);
    pipeline.expire(streamRepoKey(cache.repositoryId), ttlSeconds);
    pipeline.expire(streamPathKey(repoName), ttlSeconds);
    if (cache.sourceId) {
      pipeline.expire(streamSourceKey(cache.sourceId), ttlSeconds);
    }
    await pipeline.exec();
  }

  private async transitionSessionToFinalizing(
    session: {
      id: string;
      repositoryId: string;
      streamPath: string;
      status: RecordingSessionStatus;
      endReason: RecordingSessionEndReason | null;
      sourceId: string | null;
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
    await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);

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

    const clearedKeys: string[] = [];
    for (const key of keys) {
      const value = await redis.get(key);
      if (value === recordingSessionId) {
        await redis.del(key);
        clearedKeys.push(key);
      } else if (key === streamSourceKey(sourceId ?? "")) {
        const sourceMapping = this.parseRedisRecord<StreamSourceMapping>(value);
        if (sourceMapping?.recordingSessionId === recordingSessionId) {
          await redis.del(key);
          clearedKeys.push(key);
        }
      } else if (key === streamRecordingKey(recordingSessionId)) {
        await redis.del(key);
        clearedKeys.push(key);
      }
    }

    if (clearedKeys.length > 0) {
      console.info("[rtmp-state] live-pointers-cleared", {
        recordingSessionId,
        repositoryId,
        repositoryName,
        sourceId: sourceId ?? null,
        clearedKeys,
      });
    }
  }

  async getSourceMapping(sourceId: string): Promise<StreamSourceMapping | null> {
    return this.parseRedisRecord<StreamSourceMapping>(await redis.get(streamSourceKey(sourceId)));
  }

  async getSegmentMapping(segmentPath: string): Promise<SegmentOwnershipMapping | null> {
    return this.parseRedisRecord<SegmentOwnershipMapping>(await redis.get(streamSegmentKey(segmentPath)));
  }

  private async resolveSegmentSourceMapping(
    streamPath: string,
    sourceId?: string,
  ): Promise<StreamSourceMapping | null> {
    if (sourceId) {
      const sourceMapping = await this.getSourceMapping(sourceId);
      if (sourceMapping) {
        return sourceMapping;
      }
    }

    const liveCache = await this.getLiveCacheByPath(streamPath);
    if (!liveCache?.sourceId) {
      return null;
    }

    return this.getSourceMapping(liveCache.sourceId);
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
      console.warn("[rtmp-reconcile] active-path-query-failed", {
        reason: message,
      });
      return null;
    }
  }

  private async cleanupOrphanConnections(
    activeSessions: Array<{
      id: string;
      repositoryId: string;
      status: RecordingSessionStatus;
    }>,
    now: number,
  ) {
    const sessionStatusById = new Map(activeSessions.map((session) => [session.id, session.status]));
    const connections = await streamOwnershipService.listConnections();

    for (const connection of connections) {
      const currentOwner = await streamOwnershipService.getCurrentOwner(connection.streamId);
      const isCurrentOwnerConnection =
        currentOwner?.recordingSessionId === connection.recordingSessionId &&
        currentOwner.connectionId === connection.connectionId &&
        currentOwner.generation === connection.generation;

      if (isCurrentOwnerConnection) {
        continue;
      }

      await redis.del(`conn:${connection.connectionId}`);
      console.info("[rtmp-reconcile] orphan-connection-cleanup", {
        recordingSessionId: connection.recordingSessionId,
        repositoryId: connection.repositoryId,
        connectionId: connection.connectionId,
        generation: connection.generation,
        connectionStatus: connection.status,
        connectionLeaseExpiresAt: new Date(connection.leaseExpiresAt).toISOString(),
        connectionLastHeartbeatAt: new Date(connection.lastHeartbeatAt).toISOString(),
        connectionIsStale: streamOwnershipService.isStaleOwner(connection, now),
        ownerRecordingSessionId: currentOwner?.recordingSessionId ?? null,
        ownerConnectionId: currentOwner?.connectionId ?? null,
        ownerGeneration: currentOwner?.generation ?? null,
        ownerStatus: currentOwner?.status ?? null,
        sessionStatus: sessionStatusById.get(connection.recordingSessionId) ?? null,
      });
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
}

export const recordingSessionService = new RecordingSessionService();
