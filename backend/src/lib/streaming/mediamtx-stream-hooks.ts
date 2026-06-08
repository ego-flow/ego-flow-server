import {
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
} from "@prisma/client";

import {
  RECORDING_ACTIVE_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../../constants/stream/stream-constants";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type {
  StreamNotReadyHookInput,
  StreamReadyHookInput,
} from "../../types/stream/request";
import type { RecordingSessionLiveCache } from "../../types/stream";
import { redis } from "../infra/redis";
import { streamOwnershipService } from "./stream-ownership";
import { streamRecordingKey } from "./stream-keys";
import { clearLivePointers } from "./stream-live-cache";
import {
  extractRecordingSessionIdFromStreamPath,
  extractRepositoryNameFromStreamPath,
} from "./stream-paths";
import { recordingSessionService } from "./recording-session";

export const handleMediamtxStreamReady = async (
  input: StreamReadyHookInput,
): Promise<void> => {
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
};

export const handleMediamtxStreamNotReady = async (
  input: StreamNotReadyHookInput,
): Promise<void> => {
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
};
