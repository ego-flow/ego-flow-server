import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  RecordingSegmentStatus,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
  VideoStatus,
} from "@prisma/client";

import {
  HTTP_STREAM_TIMEOUT_MS,
  HTTP_UPLOAD_LOCK_TTL_SECONDS,
  RECORDING_ACTIVE_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../constants/stream/stream-constants";
import { runtimeConfig as env } from "../config/runtime";
import { BadRequest, Conflict, Forbidden, NotFound, PreconditionFailed } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import type { HttpStreamFinishInput, HttpStreamStartInput } from "../schemas/stream.schema";
import type { RecordingSessionLiveCache } from "../types/stream";
import { httpUploadLockKey, streamRecordingKey } from "../utils/stream-keys";
import { recordingSessionService } from "./recording-session.service";
import { streamOwnershipService } from "./stream-ownership.service";

type HttpUploadCache = RecordingSessionLiveCache & {
  ingestType: "HTTP";
  status: "STREAMING";
  rawPath: string;
  bytesReceived: number;
  lastSequence: number | null;
  lastChunkAt: number;
};

class HttpUploadTransitionRace extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpUploadTransitionRace";
  }
}

export class HttpStreamService {
  async start(recordingSessionId: string, requestUserId: string, input: HttpStreamStartInput) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });

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

    const rawPath = this.buildRawPath(session.streamPath, session.id);
    await fs.mkdir(path.dirname(rawPath), { recursive: true });

    const now = new Date();
    const cache = this.buildStreamingCache({
      repositoryId: session.repositoryId,
      repositoryName: recordingSessionService.extractRepositoryName(session.streamPath),
      userId: session.userId,
      deviceType: session.deviceType,
      rawPath,
      bytesReceived: 0,
      lastSequence: null,
      lastChunkAt: now.getTime(),
    });

    await prisma.$transaction(async (tx) => {
      const sessionUpdate = await tx.recordingSession.updateMany({
        where: {
          id: session.id,
          status: RecordingSessionStatus.PENDING,
          ingestType: RecordingSessionIngestType.HTTP,
        },
        data: {
          status: RecordingSessionStatus.STREAMING,
          readyAt: session.readyAt ?? now,
        },
      });
      if (sessionUpdate.count !== 1) {
        throw Conflict("Recording session could not be started.");
      }

      await tx.recordingSegment.create({
        data: {
          recordingSessionId: session.id,
          rawPath,
          status: RecordingSegmentStatus.WRITING,
        },
      });
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
      status: "STREAMING" as const,
      bytes_received: 0,
      last_sequence: null,
    };
  }

  async appendChunk(
    recordingSessionId: string,
    requestUserId: string,
    input: {
      sequence: number;
      offset: number;
      chunk: Buffer;
    },
  ) {
    if (input.chunk.length === 0) {
      throw BadRequest("Chunk body must not be empty.");
    }

    return this.withUploadLock(recordingSessionId, async () => {
      const cache = await this.getStreamingHttpCache(recordingSessionId);
      this.assertOwner(cache, requestUserId);

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
  }

  async finish(recordingSessionId: string, requestUserId: string, input: HttpStreamFinishInput) {
    const result = await this.withUploadLock(recordingSessionId, async () => {
      const cache = await this.getStreamingHttpCache(recordingSessionId);
      this.assertOwner(cache, requestUserId);

      if (cache.bytesReceived !== input.total_bytes) {
        throw PreconditionFailed(`Unexpected total bytes. Expected ${cache.bytesReceived}.`);
      }

      const stat = await this.statFile(cache.rawPath);
      if (!stat || stat.size !== input.total_bytes) {
        throw PreconditionFailed("Stored raw file size does not match total bytes.");
      }

      const closedAt = new Date();
      await prisma.$transaction(async (tx) => {
        const sessionUpdate = await tx.recordingSession.updateMany({
          where: {
            id: recordingSessionId,
            userId: requestUserId,
            status: RecordingSessionStatus.STREAMING,
            ingestType: RecordingSessionIngestType.HTTP,
          },
          data: {
            status: RecordingSessionStatus.CLOSED,
            closedAt,
            endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
          },
        });
        if (sessionUpdate.count !== 1) {
          throw Conflict("Recording session could not be closed.");
        }

        const segmentUpdate = await tx.recordingSegment.updateMany({
          where: {
            recordingSessionId,
            status: RecordingSegmentStatus.WRITING,
          },
          data: {
            status: RecordingSegmentStatus.WRITE_DONE,
            completedAt: closedAt,
          },
        });
        if (segmentUpdate.count !== 1) {
          throw Conflict("Recording segment could not be completed.");
        }
      });

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

    await this.clearHttpPointers(recordingSessionId);
    await recordingSessionService.tryEnqueueFinalize(recordingSessionId);

    console.info("[http-stream] finished", {
      recordingSessionId,
      repositoryId: result.cache.repositoryId,
      repositoryName: result.cache.repositoryName,
      userId: result.cache.userId,
      bytesReceived: result.cache.bytesReceived,
    });

    return result.response;
  }

  async reconcileHttpUploads() {
    const sessions = await prisma.recordingSession.findMany({
      where: {
        status: RecordingSessionStatus.STREAMING,
        ingestType: RecordingSessionIngestType.HTTP,
      },
    });

    const nowMs = Date.now();
    for (const session of sessions) {
      const rawCache = await redis.get(streamRecordingKey(session.id));
      const cache = this.parseHttpUploadCache(rawCache);

      if (!cache) {
        await this.withUploadLockIfAvailable(session.id, async () => {
          await this.failHttpUpload(session, null, "HTTP upload cache is missing.");
        });
        continue;
      }

      if (nowMs - cache.lastChunkAt <= HTTP_STREAM_TIMEOUT_MS) {
        continue;
      }

      await this.withUploadLockIfAvailable(session.id, async () => {
        const refreshedCache = this.parseHttpUploadCache(await redis.get(streamRecordingKey(session.id)));
        if (!refreshedCache) {
          await this.failHttpUpload(session, null, "HTTP upload cache is missing.");
          return;
        }
        if (Date.now() - refreshedCache.lastChunkAt <= HTTP_STREAM_TIMEOUT_MS) {
          return;
        }

        const stat = await this.statFile(refreshedCache.rawPath);
        if (stat && stat.size > 0 && stat.size === refreshedCache.bytesReceived) {
          const claimed = await this.closeUnexpectedAndMarkWriteDone(session.id);
          if (!claimed) {
            console.info("[http-stream] timeout-recovered-skipped", {
              recordingSessionId: session.id,
              reason: "state-transition-not-claimed",
            });
            return;
          }
          await this.clearHttpPointers(session.id);
          await recordingSessionService.tryEnqueueFinalize(session.id);
          console.info("[http-stream] timeout-recovered-write-done", {
            recordingSessionId: session.id,
            repositoryId: session.repositoryId,
            repositoryName: refreshedCache.repositoryName,
            bytesReceived: refreshedCache.bytesReceived,
          });
          return;
        }

        const reason = !stat
          ? "HTTP upload raw file is missing."
          : stat.size === 0
            ? "HTTP upload raw file is empty."
            : `HTTP upload raw file size mismatch. expected=${refreshedCache.bytesReceived} actual=${stat.size}.`;
        await this.failHttpUpload(session, refreshedCache, reason);
      });
    }
  }

  private buildRawPath(streamPath: string, recordingSessionId: string) {
    const repositoryName = recordingSessionService.extractRepositoryName(streamPath);
    return path.join(env.RAW_ROOT, "http", repositoryName, recordingSessionId, "recording.mp4");
  }

  private buildStreamingCache(params: {
    repositoryId: string;
    repositoryName: string;
    userId: string;
    deviceType: string | null;
    rawPath: string;
    bytesReceived: number;
    lastSequence: number | null;
    lastChunkAt: number;
  }): HttpUploadCache {
    const cache: HttpUploadCache = {
      repositoryId: params.repositoryId,
      repositoryName: params.repositoryName,
      userId: params.userId,
      ingestType: "HTTP",
      status: "STREAMING",
      rawPath: params.rawPath,
      bytesReceived: params.bytesReceived,
      lastSequence: params.lastSequence,
      lastChunkAt: params.lastChunkAt,
    };
    if (params.deviceType) {
      cache.deviceType = params.deviceType;
    }
    return cache;
  }

  private async getStreamingHttpCache(recordingSessionId: string) {
    const cache = this.parseHttpUploadCache(await redis.get(streamRecordingKey(recordingSessionId)));
    if (!cache) {
      throw NotFound("Active HTTP stream not found.");
    }
    return cache;
  }

  private parseHttpUploadCache(raw: string | null): HttpUploadCache | null {
    if (!raw) {
      return null;
    }

    try {
      const cache = JSON.parse(raw) as RecordingSessionLiveCache;
      if (
        cache.ingestType !== "HTTP" ||
        cache.status !== "STREAMING" ||
        typeof cache.rawPath !== "string" ||
        typeof cache.bytesReceived !== "number" ||
        !Number.isSafeInteger(cache.bytesReceived) ||
        (cache.lastSequence !== null && typeof cache.lastSequence !== "number") ||
        typeof cache.lastChunkAt !== "number"
      ) {
        return null;
      }

      return cache as HttpUploadCache;
    } catch (_error) {
      return null;
    }
  }

  private assertOwner(cache: HttpUploadCache, requestUserId: string) {
    if (cache.userId !== requestUserId) {
      throw Forbidden("Only the HTTP stream owner can upload chunks.");
    }
  }

  private async withUploadLock<T>(recordingSessionId: string, callback: () => Promise<T>): Promise<T> {
    const lockKey = httpUploadLockKey(recordingSessionId);
    const lockValue = randomUUID();
    const locked = await redis.set(lockKey, lockValue, "EX", HTTP_UPLOAD_LOCK_TTL_SECONDS, "NX");
    if (locked !== "OK") {
      throw Conflict("HTTP stream upload is busy.");
    }

    try {
      return await callback();
    } finally {
      if ((await redis.get(lockKey)) === lockValue) {
        await redis.del(lockKey);
      }
    }
  }

  private async withUploadLockIfAvailable(recordingSessionId: string, callback: () => Promise<void>) {
    const lockKey = httpUploadLockKey(recordingSessionId);
    const lockValue = randomUUID();
    const locked = await redis.set(lockKey, lockValue, "EX", HTTP_UPLOAD_LOCK_TTL_SECONDS, "NX");
    if (locked !== "OK") {
      return;
    }

    try {
      await callback();
    } finally {
      if ((await redis.get(lockKey)) === lockValue) {
        await redis.del(lockKey);
      }
    }
  }

  private async closeUnexpectedAndMarkWriteDone(recordingSessionId: string) {
    const closedAt = new Date();
    try {
      await prisma.$transaction(async (tx) => {
        const sessionUpdate = await tx.recordingSession.updateMany({
          where: {
            id: recordingSessionId,
            status: RecordingSessionStatus.STREAMING,
            ingestType: RecordingSessionIngestType.HTTP,
          },
          data: {
            status: RecordingSessionStatus.CLOSED,
            closedAt,
            endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
          },
        });
        if (sessionUpdate.count !== 1) {
          throw new HttpUploadTransitionRace("HTTP upload session was already closed.");
        }

        const segmentUpdate = await tx.recordingSegment.updateMany({
          where: {
            recordingSessionId,
            status: RecordingSegmentStatus.WRITING,
          },
          data: {
            status: RecordingSegmentStatus.WRITE_DONE,
            completedAt: closedAt,
          },
        });
        if (segmentUpdate.count !== 1) {
          throw new HttpUploadTransitionRace("HTTP upload segment was already finalized.");
        }
      });
      return true;
    } catch (error) {
      if (error instanceof HttpUploadTransitionRace) {
        return false;
      }
      throw error;
    }
  }

  private async failHttpUpload(
    session: {
      id: string;
      repositoryId: string;
      ownerId: string;
      userId: string;
      deviceType: string | null;
      streamPath: string;
    },
    cache: HttpUploadCache | null,
    errorMessage: string,
  ) {
    const segment = await prisma.recordingSegment.findUnique({
      where: { recordingSessionId: session.id },
    });
    const rawPath = cache?.rawPath ?? segment?.rawPath ?? this.buildRawPath(session.streamPath, session.id);
    const closedAt = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        const sessionUpdate = await tx.recordingSession.updateMany({
          where: {
            id: session.id,
            status: RecordingSessionStatus.STREAMING,
            ingestType: RecordingSessionIngestType.HTTP,
          },
          data: {
            status: RecordingSessionStatus.CLOSED,
            closedAt,
            endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
          },
        });
        if (sessionUpdate.count !== 1) {
          throw new HttpUploadTransitionRace("HTTP upload session was already closed.");
        }

        const segmentUpdate = await tx.recordingSegment.updateMany({
          where: {
            recordingSessionId: session.id,
            status: RecordingSegmentStatus.WRITING,
          },
          data: {
            status: RecordingSegmentStatus.FAILED,
            completedAt: closedAt,
          },
        });
        if (segmentUpdate.count !== 1) {
          throw new HttpUploadTransitionRace("HTTP upload segment was already finalized.");
        }

        await tx.video.upsert({
          where: { recordingSessionId: session.id },
          create: {
            id: randomUUID(),
            repositoryId: session.repositoryId,
            recordingSessionId: session.id,
            rawRecordingPath: rawPath,
            streamPath: session.streamPath,
            deviceType: session.deviceType,
            recorder: session.userId,
            status: VideoStatus.FAILED,
            errorMessage,
            processingStartedAt: closedAt,
            processingCompletedAt: closedAt,
          },
          update: {
            repositoryId: session.repositoryId,
            rawRecordingPath: rawPath,
            streamPath: session.streamPath,
            deviceType: session.deviceType,
            recorder: session.userId,
            status: VideoStatus.FAILED,
            errorMessage,
            processingCompletedAt: closedAt,
          },
        });
      });
    } catch (error) {
      if (error instanceof HttpUploadTransitionRace) {
        console.info("[http-stream] timeout-failed-skipped", {
          recordingSessionId: session.id,
          repositoryId: session.repositoryId,
          repositoryName: recordingSessionService.extractRepositoryName(session.streamPath),
          reason: "state-transition-not-claimed",
        });
        return false;
      }
      throw error;
    }

    await this.clearHttpPointers(session.id);
    console.warn("[http-stream] timeout-failed", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: recordingSessionService.extractRepositoryName(session.streamPath),
      userId: session.userId,
      rawPath,
      reason: errorMessage,
    });
    return true;
  }

  private async clearHttpPointers(recordingSessionId: string) {
    await redis.multi()
      .del(streamRecordingKey(recordingSessionId), httpUploadLockKey(recordingSessionId))
      .srem(STREAM_ACTIVE_SET_KEY, recordingSessionId)
      .exec();
  }

  private async statFile(filePath: string) {
    try {
      return await fs.stat(filePath);
    } catch (_error) {
      return null;
    }
  }
}

export const httpStreamService = new HttpStreamService();
