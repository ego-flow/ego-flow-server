import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { RecordingSessionEndReason } from "@prisma/client";

import { runtimeConfig as env } from "../../config/runtime";
import {
  HTTP_STREAM_TIMEOUT_MS,
  HTTP_UPLOAD_LOCK_TTL_SECONDS,
  STREAM_ACTIVE_SET_KEY,
} from "../../constants/stream/stream-constants";
import { Conflict } from "../core/errors";
import { redis } from "../infra/redis";
import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import {
  recordingSessionRepository,
  type RecordingSessionRecord,
} from "../../repositories/recording-session.repository";
import { videosRepository } from "../../repositories/videos.repository";
import type { RecordingSessionLiveCache } from "../../types/stream";
import { recordingSessionService } from "./recording-session";
import { httpUploadLockKey, streamRecordingKey } from "./stream-keys";
import { extractRepositoryNameFromStreamPath } from "./stream-paths";

export type HttpUploadCache = RecordingSessionLiveCache & {
  ingestType: "HTTP";
  status: "STREAMING";
  rawPath: string;
  bytesReceived: number;
  lastSequence: number | null;
  lastChunkAt: number;
};

export const buildHttpUploadRawPath = (streamPath: string, recordingSessionId: string) => {
  const repositoryName = extractRepositoryNameFromStreamPath(streamPath);
  return path.join(env.RAW_ROOT, "http", repositoryName, recordingSessionId, "recording.mp4");
};

export const buildHttpUploadCache = (params: {
  repositoryId: string;
  repositoryName: string;
  userId: string;
  deviceType: string | null;
  rawPath: string;
  bytesReceived: number;
  lastSequence: number | null;
  lastChunkAt: number;
}): HttpUploadCache => {
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
};

export const parseHttpUploadCache = (raw: string | null): HttpUploadCache | null => {
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
};

export const withHttpUploadLock = async <T>(
  recordingSessionId: string,
  callback: () => Promise<T>,
): Promise<T> => {
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
};

const withHttpUploadLockIfAvailable = async (
  recordingSessionId: string,
  callback: () => Promise<void>,
) => {
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
};

export const clearHttpUploadPointers = async (recordingSessionId: string) => {
  await redis.multi()
    .del(streamRecordingKey(recordingSessionId), httpUploadLockKey(recordingSessionId))
    .srem(STREAM_ACTIVE_SET_KEY, recordingSessionId)
    .exec();
};

export const statFile = async (filePath: string) => {
  try {
    return await fs.stat(filePath);
  } catch (_error) {
    return null;
  }
};

const closeUnexpectedAndMarkWriteDone = async (recordingSessionId: string) => {
  const closedAt = new Date();
  const sessionClosed = await recordingSessionRepository.closeStreamingHttpUpload({
    recordingSessionId,
    closedAt,
    endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
  });
  if (!sessionClosed) {
    return false;
  }

  return recordingSegmentRepository.markWriteDoneByRecordingSessionId(recordingSessionId, closedAt);
};

const failHttpUpload = async (
  session: RecordingSessionRecord,
  cache: HttpUploadCache | null,
  errorMessage: string,
) => {
  const segment = await recordingSegmentRepository.findRawPathByRecordingSessionId(session.id);
  const rawPath = cache?.rawPath ?? segment?.rawPath ?? buildHttpUploadRawPath(session.streamPath, session.id);

  const closedAt = new Date();
  const failed = await recordingSessionRepository.closeStreamingHttpUpload({
    recordingSessionId: session.id,
    closedAt,
    endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
  });
  if (!failed) {
    console.info("[http-stream] timeout-failed-skipped", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
      reason: "state-transition-not-claimed",
    });
    return false;
  }
  const segmentFailed = await recordingSegmentRepository.markFailedByRecordingSessionId(session.id, closedAt);
  if (!segmentFailed) {
    console.info("[http-stream] timeout-failed-skipped", {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
      reason: "segment-transition-not-claimed",
    });
    return false;
  }
  await videosRepository.upsertFailedRecording({
    repositoryId: session.repositoryId,
    recordingSessionId: session.id,
    rawRecordingPath: rawPath,
    streamPath: session.streamPath,
    deviceType: session.deviceType,
    recorder: session.userId,
    errorMessage,
    processedAt: closedAt,
  });

  await clearHttpUploadPointers(session.id);
  console.warn("[http-stream] timeout-failed", {
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
    userId: session.userId,
    rawPath,
    reason: errorMessage,
  });
  return true;
};

export const reconcileHttpUploads = async () => {
  const sessions = await recordingSessionRepository.findStreamingHttpUploads();

  const nowMs = Date.now();
  for (const session of sessions) {
    const rawCache = await redis.get(streamRecordingKey(session.id));
    const cache = parseHttpUploadCache(rawCache);

    if (!cache) {
      await withHttpUploadLockIfAvailable(session.id, async () => {
        await failHttpUpload(session, null, "HTTP upload cache is missing.");
      });
      continue;
    }

    if (nowMs - cache.lastChunkAt <= HTTP_STREAM_TIMEOUT_MS) {
      continue;
    }

    await withHttpUploadLockIfAvailable(session.id, async () => {
      const refreshedCache = parseHttpUploadCache(await redis.get(streamRecordingKey(session.id)));
      if (!refreshedCache) {
        await failHttpUpload(session, null, "HTTP upload cache is missing.");
        return;
      }
      if (Date.now() - refreshedCache.lastChunkAt <= HTTP_STREAM_TIMEOUT_MS) {
        return;
      }

      const stat = await statFile(refreshedCache.rawPath);
      if (stat && stat.size > 0 && stat.size === refreshedCache.bytesReceived) {
        const claimed = await closeUnexpectedAndMarkWriteDone(session.id);
        if (!claimed) {
          console.info("[http-stream] timeout-recovered-skipped", {
            recordingSessionId: session.id,
            reason: "state-transition-not-claimed",
          });
          return;
        }
        await clearHttpUploadPointers(session.id);
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
      await failHttpUpload(session, refreshedCache, reason);
    });
  }
};
