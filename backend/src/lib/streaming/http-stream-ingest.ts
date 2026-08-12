import fs from "node:fs/promises";
import path from "node:path";

import {
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
} from "@prisma/client";

import {
  RECORDING_ACTIVE_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../../constants/stream/stream-constants";
import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type {
  HttpStreamChunkInput,
  HttpStreamFinishInput,
  HttpStreamStartInput,
} from "../../types/stream/request";
import type {
  HttpStreamAppendChunkResponse,
  HttpStreamFinishResponse,
  HttpStreamStartResponse,
} from "../../types/stream/response";
import { BadRequest, Conflict, Forbidden, NotFound, PreconditionFailed } from "../core/errors";
import { redis } from "../infra/redis";
import { recordingSessionService } from "./recording-session";
import { streamRecordingKey } from "./stream-keys";
import { extractRepositoryNameFromStreamPath } from "./stream-paths";
import { streamOwnershipService } from "./stream-ownership";
import {
  buildHttpUploadCache,
  buildHttpUploadRawPath,
  clearHttpUploadPointers,
  parseHttpUploadCache,
  statFile,
  withHttpUploadLock,
  type HttpUploadCache,
} from "./http-upload-session";

const getStreamingHttpCache = async (recordingSessionId: string) => {
  const cache = parseHttpUploadCache(await redis.get(streamRecordingKey(recordingSessionId)));
  if (!cache) {
    throw NotFound("Active HTTP stream not found.");
  }
  return cache;
};

const assertHttpStreamOwner = (cache: HttpUploadCache, requestUserId: string) => {
  if (cache.userId !== requestUserId) {
    throw Forbidden("Only the HTTP stream owner can upload chunks.");
  }
};

export const startHttpStream = async (
  recordingSessionId: string,
  requestUserId: string,
  input: HttpStreamStartInput,
): Promise<HttpStreamStartResponse> => {
  const session = await recordingSessionRepository.findById(recordingSessionId);

  if (!session) {
    throw NotFound("Recording session not found.");
  }
  if (session.userId !== requestUserId) {
    throw Forbidden("Only the session owner can start this HTTP stream.");
  }
  if (session.ingestType !== RecordingSessionIngestType.HTTP) {
    throw Conflict("Recording session is not registered for HTTP ingest.");
  }
  if (session.status !== RecordingSessionStatus.PENDING) {
    throw Conflict(`Recording session is already in ${session.status} state.`);
  }

  const ticket = await streamOwnershipService.consumePublishTicket(
    session.streamPath,
    input.publish_ticket,
    { expectedIngestType: RecordingSessionIngestType.HTTP },
  );
  if (!ticket.ok) {
    throw PreconditionFailed(`Publish ticket rejected: ${ticket.reason}.`);
  }
  if (
    ticket.ticket.recordingSessionId !== session.id ||
    ticket.ticket.repositoryId !== session.repositoryId ||
    ticket.ticket.userId !== session.userId ||
    ticket.ticket.streamPath !== session.streamPath
  ) {
    throw PreconditionFailed("Publish ticket does not match this recording session.");
  }

  const rawPath = buildHttpUploadRawPath(session.streamPath, session.id);
  await fs.mkdir(path.dirname(rawPath), { recursive: true });

  const now = new Date();
  const cache = buildHttpUploadCache({
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
    userId: session.userId,
    deviceType: session.deviceType,
    rawPath,
    bytesReceived: 0,
    lastSequence: null,
    lastChunkAt: now.getTime(),
  });

  const started = await recordingSessionRepository.markHttpUploadStreaming({
    recordingSessionId: session.id,
    readyAt: session.readyAt ?? now,
  });
  if (!started) {
    throw Conflict("Recording session could not be started.");
  }
  await recordingSegmentRepository.createWriting({
    recordingSessionId: session.id,
    rawPath,
  });

  await redis.multi()
    .set(streamRecordingKey(session.id), JSON.stringify(cache), "EX", RECORDING_ACTIVE_TTL_SECONDS)
    .sadd(STREAM_ACTIVE_SET_KEY, session.id)
    .exec();

  console.info("[http-stream] started", {
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    repositoryName: cache.repositoryName,
    userId: session.userId,
    rawPath,
  });

  return {
    recording_session_id: session.id,
    status: "STREAMING",
    bytes_received: 0,
    last_sequence: null,
  };
};

export const appendHttpStreamChunk = async (
  recordingSessionId: string,
  requestUserId: string,
  input: HttpStreamChunkInput,
): Promise<HttpStreamAppendChunkResponse> => {
  if (input.chunk.length === 0) {
    throw BadRequest("Chunk body must not be empty.");
  }

  return withHttpUploadLock(recordingSessionId, async () => {
    const cache = await getStreamingHttpCache(recordingSessionId);
    assertHttpStreamOwner(cache, requestUserId);

    const expectedSequence = cache.lastSequence === null ? 0 : cache.lastSequence + 1;
    if (input.sequence !== expectedSequence) {
      throw Conflict(`Unexpected chunk sequence. Expected ${expectedSequence}.`);
    }
    if (input.offset !== cache.bytesReceived) {
      throw PreconditionFailed(`Unexpected chunk offset. Expected ${cache.bytesReceived}.`);
    }

    const nextBytesReceived = cache.bytesReceived + input.chunk.length;
    const nextCache: HttpUploadCache = {
      ...cache,
      bytesReceived: nextBytesReceived,
      lastSequence: input.sequence,
      lastChunkAt: Date.now(),
    };

    await fs.mkdir(path.dirname(cache.rawPath), { recursive: true });
    const handle = await fs.open(cache.rawPath, "a");
    try {
      await handle.writeFile(input.chunk);
    } finally {
      await handle.close();
    }

    await redis.set(
      streamRecordingKey(recordingSessionId),
      JSON.stringify(nextCache),
      "EX",
      RECORDING_ACTIVE_TTL_SECONDS,
    );

    return {
      recording_session_id: recordingSessionId,
      bytes_received: nextBytesReceived,
      last_sequence: input.sequence,
    };
  });
};

export const finishHttpStream = async (
  recordingSessionId: string,
  requestUserId: string,
  input: HttpStreamFinishInput,
): Promise<HttpStreamFinishResponse> => {
  const result = await withHttpUploadLock(recordingSessionId, async () => {
    const cache = await getStreamingHttpCache(recordingSessionId);
    assertHttpStreamOwner(cache, requestUserId);

    if (cache.bytesReceived !== input.total_bytes) {
      throw PreconditionFailed(`Unexpected total bytes. Expected ${cache.bytesReceived}.`);
    }

    const stat = await statFile(cache.rawPath);
    if (!stat || stat.size !== input.total_bytes) {
      throw PreconditionFailed("Stored raw file size does not match total bytes.");
    }

    const closedAt = new Date();
    const completed = await recordingSessionRepository.closeStreamingHttpUpload({
      recordingSessionId,
      userId: requestUserId,
      closedAt,
      endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
    });
    if (!completed) {
      throw Conflict("Recording session could not be closed.");
    }
    const segmentCompleted = await recordingSegmentRepository.markWriteDoneByRecordingSessionId(
      recordingSessionId,
      closedAt,
    );
    if (!segmentCompleted) {
      throw Conflict("Recording segment could not be completed.");
    }

    return {
      cache,
      response: {
        recording_session_id: recordingSessionId,
        status: "CLOSED" as const,
        segment_status: "WRITE_DONE" as const,
        bytes_received: cache.bytesReceived,
      },
    };
  });

  await clearHttpUploadPointers(recordingSessionId);
  await recordingSessionService.tryEnqueueFinalize(recordingSessionId);

  console.info("[http-stream] finished", {
    recordingSessionId,
    repositoryId: result.cache.repositoryId,
    repositoryName: result.cache.repositoryName,
    userId: result.cache.userId,
    bytesReceived: result.cache.bytesReceived,
  });

  return result.response;
};
