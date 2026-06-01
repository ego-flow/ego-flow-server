import { randomUUID } from "node:crypto";

import { RecordingSessionStatus, RecordingSessionEndReason, RecordingSegmentStatus } from "@prisma/client";

import {
  RECORDING_ACTIVE_TTL_SECONDS,
  RECORDING_REGISTRATION_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../constants/stream/stream-constants";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { runtimeConfig as env } from "../config/runtime";
import { processingService } from "./processing.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamRecordingKey } from "../utils/stream-keys";
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
 * MediaMTX hook 이벤트와 STREAMING reconcile 루프를 통해 상태를 진행시킨다.
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
   * 1. hook wrapper가 추출한 publish ticket을 검증한다.
   * 2. ticket가 가리키는 PENDING 세션만 DB에서 조회한다.
   * 3. ticket를 consumed로 전환한다. 남은 TTL은 그대로 유지한다.
   * 4. DB 상태를 갱신하고 Redis live cache 및 active set을 갱신한다.
   */
  async handleStreamReady(input: StreamReadyHookInput) {
    const ticketValidation = await streamOwnershipService.validatePublishTicket(
      input.path,
      input.ticket,
      { refreshTtl: false },
    );
    if (!ticketValidation.ok) {
      console.warn("[rtmp-ticket] stream-ready-validation-rejected", {
        path: input.path,
        reason: ticketValidation.reason,
        ticketId: ticketValidation.ticketId,
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
        ticketId: ticketValidation.ticketId,
      });
      return;
    }

    const consumedTicket = await streamOwnershipService.consumePublishTicket(input.path, input.ticket);
    if (!consumedTicket.ok) {
      console.warn("[rtmp-ticket] consume-rejected", {
        recordingSessionId,
        path: input.path,
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
      ticketId: consumedTicket.ticketId,
    });

    console.info("[rtmp-state] pending-to-streaming", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      userId: session.userId,
    });
  }

  /**
   * [stream-not-ready hook 처리]
   * MediaMTX가 RTMP 연결 종료를 감지하면 호출.
   * 1. stream path에서 recordingSessionId를 복원한다.
   * 2. 종료 시각과 종료 사유를 기록하고 session을 CLOSED로 닫는다.
   * 3. live pointer를 제거한다.
   * 4. segment write가 이미 완료된 경우 후처리 job enqueue를 시도한다.
   * 5. path/session miss는 no-op + 경고 로그로 처리한다.
   */
  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    const recordingSessionId = this.extractRecordingSessionId(input.path);
    if (!recordingSessionId) {
      console.warn("[rtmp-state] stream-not-ready-path-invalid", {
        path: input.path,
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
      });
      return;
    }

    if (session.status !== RecordingSessionStatus.STREAMING) {
      console.warn("[rtmp-state] stream-not-ready-session-skipped", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        status: session.status,
      });
      return;
    }

    const endReason = session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT;
    const closedAt = session.closedAt ?? new Date();
    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.CLOSED,
        closedAt,
        endReason,
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    await this.clearLivePointers(recordingSessionId, session.repositoryId, repoName);

    console.info("[rtmp-state] stream-closed", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      endReason,
    });

    await this.tryEnqueueFinalize(recordingSessionId);
  }

  /**
   * [close-intent 기록]
   * App이 사용자 의도에 따라 RTMP socket을 닫기 직전에 호출한다.
   * 실제 연결 종료 확정과 CLOSED 전이는 stream-not-ready hook이 담당하므로,
   * 여기서는 NORMAL_DISCONNECT intent만 session row에 기록한다.
   */
  async recordCloseIntent(recordingSessionId: string, requestUserId: string, reason: string) {
    if (reason !== RecordingSessionEndReason.NORMAL_DISCONNECT) {
      throw BadRequest("Unsupported close intent reason.");
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      throw NotFound("Recording session not found.");
    }
    if (session.userId !== requestUserId) {
      throw Forbidden("Only the recording session owner can close this recording session.");
    }
    if (session.status !== RecordingSessionStatus.STREAMING) {
      throw Conflict(`Recording session is not in STREAMING state (current: ${session.status}).`);
    }

    const updated = await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
      },
    });

    console.info("[rtmp-state] close-intent-recorded", {
      recordingSessionId,
      repositoryId: updated.repositoryId,
      repositoryName: this.extractRepositoryName(updated.streamPath),
      userId: updated.userId,
      reason: updated.endReason,
    });

    return updated;
  }

  /**
   * [segment-create hook 처리]
   * MediaMTX가 새 녹화 세그먼트 파일 쓰기를 시작할 때 호출.
   * stream path의 recordingSessionId로 세션을 찾고, session 단일 RecordingSegment를 생성한다.
   * RecordingSegment를 WRITING 상태로 upsert한다.
   */
  async handleSegmentCreate(input: SegmentCreateHookInput) {
    const session = await this.resolveSegmentSession(input.path);
    if (!session) {
      console.warn("[rtmp-segment] session-missing", {
        path: input.path,
        segmentPath: input.segment_path,
      });
      return;
    }

    const recordingSessionId = session.id;

    const segment = await prisma.recordingSegment.upsert({
      where: { recordingSessionId },
      create: {
        recordingSessionId,
        rawPath: input.segment_path,
        status: RecordingSegmentStatus.WRITING,
      },
      update: {},
    });

    if (segment.rawPath !== input.segment_path) {
      console.warn("[rtmp-segment] additional-segment-ignored", {
        recordingSessionId,
        path: input.path,
        existingSegmentPath: segment.rawPath,
        ignoredSegmentPath: input.segment_path,
      });
      return;
    }

    console.info("[rtmp-segment] writing-created", {
      recordingSessionId,
      path: input.path,
      segmentPath: input.segment_path,
    });
  }

  /**
   * [segment-complete hook 처리]
   * MediaMTX가 세그먼트 파일 쓰기를 완료하면 호출.
   * stream path의 recordingSessionId로 기존 RecordingSegment만 WRITE_DONE으로 전환한다.
   * session 복구나 create hook 누락 복구는 하지 않는다.
   */
  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    const recordingSessionId = this.extractRecordingSessionId(input.path);
    if (!recordingSessionId) {
      console.warn("[rtmp-segment] complete-path-invalid", {
        path: input.path,
        segmentPath: input.segment_path,
      });
      return;
    }

    const segment = await prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
    });

    if (!segment) {
      console.warn("[rtmp-segment] complete-segment-missing", {
        recordingSessionId,
        path: input.path,
        segmentPath: input.segment_path,
      });
      return;
    }

    if (segment.rawPath !== input.segment_path) {
      console.warn("[rtmp-segment] complete-path-mismatch", {
        recordingSessionId,
        path: input.path,
        existingSegmentPath: segment.rawPath,
        ignoredSegmentPath: input.segment_path,
      });
      return;
    }

    if (segment.status !== RecordingSegmentStatus.WRITING) {
      console.info("[rtmp-segment] complete-ignored", {
        recordingSessionId,
        path: input.path,
        segmentPath: input.segment_path,
        segmentStatus: segment.status,
      });
      return;
    }

    await prisma.recordingSegment.update({
      where: { id: segment.id },
      data: {
        status: RecordingSegmentStatus.WRITE_DONE,
        completedAt: new Date(),
      },
    });

    console.info("[rtmp-segment] write-done", {
      recordingSessionId: segment.recordingSessionId,
      path: input.path,
      segmentPath: input.segment_path,
    });

    await this.tryEnqueueFinalize(segment.recordingSessionId);
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
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session || session.status !== RecordingSessionStatus.CLOSED) {
      return false;
    }

    const segment = await prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
      select: { status: true, rawPath: true },
    });

    if (!segment) {
      console.info("[rtmp-finalize] no-recording-segment", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        endReason: session.endReason ?? null,
      });
      return false;
    }

    if (segment.status === RecordingSegmentStatus.WRITING) {
      console.info("[rtmp-finalize] waiting-for-segment-complete", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        rawPath: segment.rawPath,
      });
      return false;
    }

    if (segment.status !== RecordingSegmentStatus.WRITE_DONE) {
      console.info("[rtmp-finalize] segment-not-ready", {
        recordingSessionId,
        repositoryId: session.repositoryId,
        repositoryName: this.extractRepositoryName(session.streamPath),
        segmentStatus: segment.status,
      });
      return false;
    }

    const repoName = this.extractRepositoryName(session.streamPath);
    const payload: RecordingFinalizeJobData = {
      recordingSessionId: session.id,
      videoId: randomUUID(),
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
      videoId: payload.videoId,
      segmentStatus: segment.status,
    });
    return true;
  }

  /**
   * [상태 정합성 보정 - reconcile]
   * 5초 간격으로 실행. 비정상 종료로 인한 상태 불일치를 보정한다.
   * - STREAMING: active path가 없거나 closedAt이 기록되어 있으면 CLOSED로 보정 후 segment complete 기반 enqueue 시도
   */
  async reconcileSessions() {
    const activeSessions = await prisma.recordingSession.findMany({
      where: {
        status: RecordingSessionStatus.STREAMING,
      },
    });

    const activeStreamPaths = activeSessions.length > 0 ? await this.getActiveStreamPaths() : null;

    for (const session of activeSessions) {
      const repoName = this.extractRepositoryName(session.streamPath);

      if (session.closedAt) {
        await this.closeStreamingSession(session, {
          endReason: session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
          logPrefix: "[rtmp-reconcile] not-ready-streaming-closed",
        });
        await this.tryEnqueueFinalize(session.id);
        continue;
      }

      const activePathMissing = activeStreamPaths ? !activeStreamPaths.has(this.normalizeStreamPath(session.streamPath)) : false;
      if (activePathMissing) {
        await this.closeStreamingSession(session, {
          endReason: session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
          logPrefix: "[rtmp-reconcile] missing-active-path-closed",
          repositoryName: repoName,
          activeStreamPaths: activeStreamPaths ? Array.from(activeStreamPaths.values()) : null,
        });
        await this.tryEnqueueFinalize(session.id);
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

  private async closeStreamingSession(
    session: {
      id: string;
      repositoryId: string;
      streamPath: string;
      status: RecordingSessionStatus;
      endReason: RecordingSessionEndReason | null;
      closedAt?: Date | null;
    },
    options: {
      endReason: RecordingSessionEndReason;
      logPrefix: string;
      [key: string]: unknown;
    },
  ) {
    const closedAt = session.closedAt ?? new Date();
    await prisma.recordingSession.update({
      where: { id: session.id },
      data: {
        status: RecordingSessionStatus.CLOSED,
        closedAt,
        endReason: session.endReason ?? options.endReason,
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    await this.clearLivePointers(session.id, session.repositoryId, repoName);

    const { logPrefix, endReason: _endReason, ...details } = options;
    console.info(logPrefix, {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      previousStatus: session.status,
      ...details,
    });
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

  private async resolveSegmentSession(
    streamPath: string,
    allowedStatuses: RecordingSessionStatus[] = [RecordingSessionStatus.STREAMING],
  ) {
    const recordingSessionId = this.extractRecordingSessionId(streamPath);
    if (!recordingSessionId) {
      return null;
    }
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (
      !session ||
      !allowedStatuses.includes(session.status)
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

}

export const recordingSessionService = new RecordingSessionService();
