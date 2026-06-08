import { randomUUID } from "node:crypto";

import { RecordingSessionIngestType, RecordingSessionStatus } from "@prisma/client";

import { RECORDING_REGISTRATION_TTL_SECONDS } from "../../constants/stream/stream-constants";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type { RepositoryRecord } from "../../types/repository";
import type { StreamRegisterInput } from "../../types/stream/request";
import type {
  StreamPublishTicketResponse,
  StreamRegisterResponse,
} from "../../types/stream/response";
import { Conflict, Forbidden, NotFound, PreconditionFailed } from "../core/errors";
import { redis } from "../infra/redis";
import { getTargetDirectory } from "../storage/storage";
import { recordingSessionService } from "./recording-session";
import { streamRecordingKey } from "./stream-keys";
import { streamOwnershipService } from "./stream-ownership";

const buildStreamPath = (repositoryName: string, recordingSessionId: string) =>
  `live/${repositoryName}/${recordingSessionId}`;

const findReusablePendingSession = async (
  repositoryId: string,
  userId: string,
  deviceType: string | null,
  ingestType: RecordingSessionIngestType,
) => {
  const reusableSession = await recordingSessionRepository.findReusablePendingSession({
    repositoryId,
    userId,
    deviceType,
    ingestType,
  });

  if (!reusableSession) {
    return null;
  }

  const refreshedSession = await recordingSessionRepository.refreshPendingSession(reusableSession.id);
  await recordingSessionService.cachePendingSession(
    refreshedSession,
    RECORDING_REGISTRATION_TTL_SECONDS,
  );
  return refreshedSession;
};

export const registerRecordingSession = async (
  userId: string,
  repository: RepositoryRecord,
  input: StreamRegisterInput,
): Promise<StreamRegisterResponse> => {
  const existingSession = await findReusablePendingSession(
    repository.id,
    userId,
    input.deviceType ?? null,
    input.ingestType,
  );

  if (existingSession) {
    console.info("[rtmp-register] reused-pending", {
      recordingSessionId: existingSession.id,
      repositoryId: repository.id,
      repositoryName: repository.name,
      ownerId: repository.ownerId,
      userId,
      deviceType: existingSession.deviceType,
      ingestType: existingSession.ingestType,
      streamPath: existingSession.streamPath,
      status: existingSession.status,
    });

    return {
      recordingSessionId: existingSession.id,
    };
  }

  const recordingSessionId = randomUUID();
  const streamPath = buildStreamPath(repository.name, recordingSessionId);
  const session = await recordingSessionService.createSession({
    id: recordingSessionId,
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId,
    ...(input.deviceType ? { deviceType: input.deviceType } : {}),
    ingestType: input.ingestType,
    streamPath,
    targetDirectory: getTargetDirectory(),
  });

  console.info("[rtmp-register] issued", {
    recordingSessionId: session.id,
    repositoryId: repository.id,
    repositoryName: repository.name,
    ownerId: repository.ownerId,
    userId,
    deviceType: input.deviceType ?? null,
    ingestType: input.ingestType,
    streamPath,
    status: session.status,
  });

  return {
    recordingSessionId: session.id,
  };
};

export const issueRecordingPublishTicket = async (
  requestUserId: string,
  recordingSessionId: string,
): Promise<StreamPublishTicketResponse> => {
  const session = await recordingSessionRepository.findById(recordingSessionId);

  if (!session) {
    throw NotFound("Recording session not found.");
  }

  if (session.userId !== requestUserId) {
    throw Forbidden("Only the session owner can request a publish ticket.");
  }

  if (session.status !== RecordingSessionStatus.PENDING) {
    throw Conflict(`Recording session is already in ${session.status} state.`);
  }

  const pendingCache = await redis.get(streamRecordingKey(session.id));
  if (!pendingCache) {
    throw PreconditionFailed("Recording session registration has expired. Please register again.");
  }

  const ticketGrant = await streamOwnershipService.issuePublishTicket({
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    userId: session.userId,
    ingestType: session.ingestType,
    streamPath: session.streamPath,
  });

  console.info("[rtmp-ticket] issued", {
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    userId: session.userId,
    streamPath: session.streamPath,
    ticketId: ticketGrant.ticketId,
    ticketTtlSec: streamOwnershipService.getPublishTicketTtlSeconds(),
  });

  return {
    stream_path: session.streamPath,
    publish_ticket: ticketGrant.ticketId,
  };
};
