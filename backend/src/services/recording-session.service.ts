import { randomUUID } from "node:crypto";

import {
  RecordingSessionStatus,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSegmentStatus,
} from "@prisma/client";

import {
  RECORDING_REGISTRATION_TTL_SECONDS,
} from "../constants/stream/stream-constants";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { runtimeConfig as env } from "../config/runtime";
import { processingService } from "./processing.service";
import { streamRecordingKey } from "../lib/stream-keys";
import { clearLivePointers } from "../lib/stream-live-cache";
import {
  extractRecordingSessionIdFromStreamPath,
  extractRepositoryNameFromStreamPath,
  normalizeStreamPath,
} from "../lib/stream-paths";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import type {
  RecordingSessionLiveCache,
  RecordingFinalizeJobData,
} from "../types/stream";

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
      userId: string;
      deviceType: string | null;
      ingestType: RecordingSessionIngestType;
      streamPath: string;
    },
    ttlSeconds: number,
  ) {
    const liveCache: RecordingSessionLiveCache = {
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      userId: session.userId,
      ingestType: session.ingestType,
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

    const mediamtxSessions = activeSessions.filter(
      (session) => session.ingestType === RecordingSessionIngestType.MEDIAMTX,
    );
    const activeStreamPaths = mediamtxSessions.length > 0 ? await this.getActiveStreamPaths() : null;

    for (const session of mediamtxSessions) {
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
   * RTMP/HLS 인증에서 사용된다.
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
    await clearLivePointers(session.id, session.repositoryId, repoName);

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
   * [stream path → repository 이름 추출]
   * "live/{repoName}/{recordingSessionId}" 형식의 stream path에서 repository 이름 부분을 추출한다.
   * 형식이 맞지 않으면 에러를 던진다.
   */
  extractRepositoryName(streamPath: string): string {
    return extractRepositoryNameFromStreamPath(streamPath);
  }

  private extractRecordingSessionId(streamPath: string): string | null {
    return extractRecordingSessionIdFromStreamPath(streamPath);
  }

  private normalizeStreamPath(streamPath: string): string {
    return normalizeStreamPath(streamPath);
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
