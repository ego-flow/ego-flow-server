import { RecordingSessionIngestType } from "@prisma/client";

import { redis } from "../infra/redis";
import type { RecordingSessionLiveCache } from "../../types/stream";
import { streamRecordingKey } from "./stream-keys";
import {
  extractRecordingSessionIdFromStreamPath,
  extractRepositoryNameFromStreamPath,
} from "./stream-paths";

export type PendingRecordingSessionCacheInput = {
  id: string;
  repositoryId: string;
  ownerId: string;
  userId: string;
  deviceType: string | null;
  ingestType: RecordingSessionIngestType;
  streamPath: string;
};

const parseRedisRecord = <T>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (_error) {
    return null;
  }
};

export const cachePendingRecordingSession = async (
  session: PendingRecordingSessionCacheInput,
  ttlSeconds: number,
): Promise<void> => {
  const liveCache: RecordingSessionLiveCache = {
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
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
    ownerId: liveCache.ownerId,
    repositoryName: liveCache.repositoryName,
    userId: session.userId,
    ttlSec: ttlSeconds,
  });
};

export const getRecordingSessionLiveCacheById = async (
  recordingSessionId: string,
): Promise<RecordingSessionLiveCache | null> =>
  parseRedisRecord<RecordingSessionLiveCache>(
    await redis.get(streamRecordingKey(recordingSessionId)),
  );

export const getRecordingSessionLiveCacheByPath = async (
  streamPath: string,
): Promise<RecordingSessionLiveCache | null> => {
  const recordingSessionId = extractRecordingSessionIdFromStreamPath(streamPath);
  if (!recordingSessionId) {
    return null;
  }

  return getRecordingSessionLiveCacheById(recordingSessionId);
};
