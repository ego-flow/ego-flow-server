import {
  RecordingSessionStatus,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSegmentStatus,
} from "@prisma/client";

import {
  RECORDING_ACTIVE_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../constants/stream/stream-constants";
import { redis } from "../lib/infra/redis";
import { clearLivePointers } from "../lib/streaming/stream-live-cache";
import {
  extractRecordingSessionIdFromStreamPath,
  extractRepositoryNameFromStreamPath,
} from "../lib/streaming/stream-paths";
import { streamRecordingKey } from "../lib/streaming/stream-keys";
import { recordingSegmentRepository } from "../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import type {
  StreamReadyHookInput,
  StreamNotReadyHookInput,
  SegmentCreateHookInput,
  SegmentCompleteHookInput,
} from "../types/stream/request";
import type { RecordingSessionLiveCache } from "../types/stream";
import { recordingSessionService } from "../lib/streaming/recording-session";
import { streamOwnershipService } from "../lib/streaming/stream-ownership";

/**
 * MediaMTX hook route use-case orchestration.
 *
 * route는 HTTP payload parsing만 담당하고, hook별 세션/세그먼트 상태 전이는 이 서비스가 담당한다.
 */
export class HooksService {
  /**
   * [stream-ready hook 처리 - PENDING -> STREAMING]
   */
  async handleStreamReady(input: StreamReadyHookInput) {
    const ticketValidation = await streamOwnershipService.validatePublishTicket(
      input.path,
      input.ticket,
      { refreshTtl: false, expectedIngestType: RecordingSessionIngestType.MEDIAMTX },
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
    const session = await recordingSessionRepository.findById(recordingSessionId);
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
      session.ingestType !== ticketValidation.ticket.ingestType ||
      session.streamPath !== ticketValidation.ticket.streamPath
    ) {
      console.warn("[rtmp-ticket] stream-ready-session-metadata-mismatch", {
        recordingSessionId,
        sessionRepositoryId: session.repositoryId,
        ticketRepositoryId: ticketValidation.ticket.repositoryId,
        sessionUserId: session.userId,
        ticketUserId: ticketValidation.ticket.userId,
        sessionIngestType: session.ingestType,
        ticketIngestType: ticketValidation.ticket.ingestType,
        sessionStreamPath: session.streamPath,
        ticketStreamPath: ticketValidation.ticket.streamPath,
        ticketId: ticketValidation.ticketId,
      });
      return;
    }

    const consumedTicket = await streamOwnershipService.consumePublishTicket(input.path, input.ticket, {
      expectedIngestType: RecordingSessionIngestType.MEDIAMTX,
    });
    if (!consumedTicket.ok) {
      console.warn("[rtmp-ticket] consume-rejected", {
        recordingSessionId,
        path: input.path,
        reason: consumedTicket.reason,
        ticketId: consumedTicket.ticketId,
      });
      return;
    }

    const repoName = extractRepositoryNameFromStreamPath(session.streamPath);
    const readyAt = session.readyAt ? null : new Date();
    await recordingSessionRepository.markStreaming(recordingSessionId, readyAt);

    const liveCache: RecordingSessionLiveCache = {
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      userId: session.userId,
      ingestType: RecordingSessionIngestType.MEDIAMTX,
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
   * [stream-not-ready hook 처리 - STREAMING -> CLOSED]
   */
  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    const recordingSessionId = extractRecordingSessionIdFromStreamPath(input.path);
    if (!recordingSessionId) {
      console.warn("[rtmp-state] stream-not-ready-path-invalid", {
        path: input.path,
      });
      return;
    }

    const session = await recordingSessionRepository.findById(recordingSessionId);
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
        repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
        status: session.status,
      });
      return;
    }

    const endReason = session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT;
    const closedAt = session.closedAt ?? new Date();
    await recordingSessionRepository.close({
      recordingSessionId,
      closedAt,
      endReason,
    });

    const repoName = extractRepositoryNameFromStreamPath(session.streamPath);
    await clearLivePointers(recordingSessionId, session.repositoryId, repoName);

    console.info("[rtmp-state] stream-closed", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      endReason,
    });

    await recordingSessionService.tryEnqueueFinalize(recordingSessionId);
  }

  /**
   * [recording-segment-create hook 처리 - segment WRITING 생성]
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
    const segment = await recordingSegmentRepository.upsertWriting({
      recordingSessionId,
      rawPath: input.segment_path,
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
   * [recording-segment-complete hook 처리 - WRITING -> WRITE_DONE]
   */
  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    const recordingSessionId = extractRecordingSessionIdFromStreamPath(input.path);
    if (!recordingSessionId) {
      console.warn("[rtmp-segment] complete-path-invalid", {
        path: input.path,
        segmentPath: input.segment_path,
      });
      return;
    }

    const segment = await recordingSegmentRepository.findByRecordingSessionId(recordingSessionId);
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

    await recordingSegmentRepository.markWriteDone(segment.id, new Date());

    console.info("[rtmp-segment] write-done", {
      recordingSessionId: segment.recordingSessionId,
      path: input.path,
      segmentPath: input.segment_path,
    });

    await recordingSessionService.tryEnqueueFinalize(segment.recordingSessionId);
  }

  private async resolveSegmentSession(streamPath: string) {
    const recordingSessionId = extractRecordingSessionIdFromStreamPath(streamPath);
    if (!recordingSessionId) {
      return null;
    }
    return recordingSessionRepository.findById(recordingSessionId);
  }
}

export const hooksService = new HooksService();
