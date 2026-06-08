import { RecordingSessionIngestType, RecordingSessionStatus } from "@prisma/client";

import { runtimeConfig as env } from "../../config/runtime";
import { STREAM_ACTIVE_SET_KEY } from "../../constants/stream/stream-constants";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type { AppUserRole } from "../../types/auth";
import type {
  HlsPlaybackTicketResponse,
  LiveStreamDetailResponse,
  LiveStreamResponse,
  RecordingSessionLiveCache,
} from "../../types/stream";
import { Conflict, NotFound } from "../core/errors";
import { redis } from "../infra/redis";
import { repositoryAccessService } from "../repositories/repository-access";
import { streamRecordingKey } from "./stream-keys";
import { streamOwnershipService } from "./stream-ownership";
import {
  extractRepositoryNameFromStreamPath,
  normalizeStreamPath,
} from "./stream-paths";

type LiveCacheEntry = {
  recordingSessionId: string;
  cache: RecordingSessionLiveCache;
};

const buildStreamPath = (repositoryName: string, recordingSessionId: string) =>
  `live/${repositoryName}/${recordingSessionId}`;

const parseLiveCache = (raw: string | null): RecordingSessionLiveCache | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as RecordingSessionLiveCache;
  } catch (_error) {
    return null;
  }
};

const getActiveLiveCaches = async (): Promise<LiveCacheEntry[]> => {
  const activeIds = await redis.smembers(STREAM_ACTIVE_SET_KEY);

  if (activeIds.length === 0) {
    return [];
  }

  const cacheRecords = await redis.mget(...activeIds.map(streamRecordingKey));
  return cacheRecords
    .map((record, index) => {
      const cache = parseLiveCache(record);
      if (!cache) {
        return null;
      }
      return { recordingSessionId: activeIds[index]!, cache };
    })
    .filter((entry): entry is LiveCacheEntry => Boolean(entry));
};

const getActiveStreamPaths = async (): Promise<Set<string> | null> => {
  const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/v3/paths/list`);
    if (!response.ok) {
      console.warn(`[live-streams] failed to query MediaMTX active paths: status ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
    const activeStreamPaths = new Set<string>();

    for (const item of payload.items ?? []) {
      if (typeof item.name !== "string") {
        continue;
      }

      const normalized = normalizeStreamPath(item.name);
      const parts = normalized.split("/");
      if (parts.length >= 3 && parts[0] === "live" && parts[1] && parts[2]) {
        activeStreamPaths.add(normalized);
      }
    }

    return activeStreamPaths;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[live-streams] failed to query MediaMTX active paths: ${message}`);
    return null;
  }
};

const getHttpUploadProgress = (
  session: {
    ingestType: RecordingSessionIngestType;
    repositoryId: string;
  },
  liveCache: RecordingSessionLiveCache | null,
) => {
  if (
    session.ingestType === RecordingSessionIngestType.HTTP &&
    liveCache?.status === "STREAMING" &&
    liveCache.repositoryId === session.repositoryId
  ) {
    return {
      bytes_received: liveCache.bytesReceived ?? null,
      last_sequence: liveCache.lastSequence ?? null,
      last_chunk_at: liveCache.lastChunkAt ? new Date(liveCache.lastChunkAt).toISOString() : null,
    };
  }

  return {
    bytes_received: null,
    last_sequence: null,
    last_chunk_at: null,
  };
};

export const listActiveLiveStreams = async (
  requestUserId: string,
  requestUserRole: AppUserRole,
): Promise<LiveStreamResponse[]> => {
  const accessibleRepoIds = await repositoryAccessService.listAccessibleActiveRepositoryIds(
    requestUserId,
    requestUserRole,
    "live.list",
  );

  const liveCaches = await getActiveLiveCaches();
  const visibleCaches = liveCaches.filter(
    ({ cache }) => accessibleRepoIds.has(cache.repositoryId),
  );

  const streams = visibleCaches.map(({ recordingSessionId, cache }) => {
    const playbackAvailable = cache.ingestType === RecordingSessionIngestType.MEDIAMTX;
    return {
      recording_session_id: recordingSessionId,
      repository_id: cache.repositoryId,
      repository_name: cache.repositoryName,
      user_id: cache.userId,
      device_type: cache.deviceType ?? null,
      ingest_type: cache.ingestType,
      stream_path: buildStreamPath(cache.repositoryName, recordingSessionId),
      status: "live" as const,
      playback_available: playbackAvailable,
    };
  });

  if (streams.length > 0) {
    console.info("[live-streams.list] generated", {
      requestUserId,
      requestUserRole,
      streamCount: streams.length,
    });
  }

  return streams;
};

export const getLiveStreamDetail = async (
  recordingSessionId: string,
  requestUserId: string,
  requestUserRole: AppUserRole,
): Promise<LiveStreamDetailResponse> => {
  const session = await recordingSessionRepository.findById(recordingSessionId);

  if (!session || session.status !== RecordingSessionStatus.STREAMING) {
    throw NotFound("Live stream not found.");
  }

  const access = await repositoryAccessService.getAccessForAction(
    requestUserId,
    requestUserRole,
    session.repositoryId,
    "live.detail",
  );
  if (!access) {
    throw NotFound("Live stream not found.");
  }
  await repositoryAccessService.assertRepositoryStatus(session.repositoryId, "active");

  const repoName = extractRepositoryNameFromStreamPath(session.streamPath);
  const playbackAvailable = session.ingestType === RecordingSessionIngestType.MEDIAMTX;
  const activeStreamPaths = playbackAvailable ? await getActiveStreamPaths() : null;
  const playbackReady = playbackAvailable
    ? activeStreamPaths
      ? activeStreamPaths.has(normalizeStreamPath(session.streamPath))
      : true
    : false;
  const liveCache = parseLiveCache(await redis.get(streamRecordingKey(recordingSessionId)));
  const httpProgress = getHttpUploadProgress(session, liveCache);

  return {
    recording_session_id: session.id,
    repository_id: session.repositoryId,
    repository_name: repoName,
    owner_id: session.ownerId,
    user_id: session.userId,
    device_type: session.deviceType ?? null,
    ingest_type: session.ingestType,
    stream_path: session.streamPath,
    registered_at: session.createdAt.toISOString(),
    status: "live" as const,
    playback_available: playbackAvailable,
    playback_ready: playbackReady,
    ...httpProgress,
  };
};

export const issueLiveStreamHlsPlaybackTicket = async (
  recordingSessionId: string,
  requestUserId: string,
  requestUserRole: AppUserRole,
): Promise<HlsPlaybackTicketResponse> => {
  const rawCache = await redis.get(streamRecordingKey(recordingSessionId));
  const liveCache = parseLiveCache(rawCache);
  if (!liveCache || liveCache.status !== "STREAMING") {
    throw NotFound("Live stream not found.");
  }

  if (liveCache.ingestType !== RecordingSessionIngestType.MEDIAMTX) {
    throw Conflict("Live stream playback is not available for this ingest type.");
  }

  const access = await repositoryAccessService.getAccessForAction(
    requestUserId,
    requestUserRole,
    liveCache.repositoryId,
    "live.playbackTicket",
  );
  if (!access) {
    throw NotFound("Live stream not found.");
  }
  await repositoryAccessService.assertRepositoryStatus(liveCache.repositoryId, "active");

  const streamPath = buildStreamPath(liveCache.repositoryName, recordingSessionId);
  const ticketGrant = await streamOwnershipService.issueHlsPlaybackTicket({
    recordingSessionId,
    repositoryId: liveCache.repositoryId,
    userId: requestUserId,
    streamPath,
  });

  console.info("[hls-ticket] issued", {
    recordingSessionId,
    repositoryId: liveCache.repositoryId,
    repositoryName: liveCache.repositoryName,
    userId: requestUserId,
    streamPath,
    ticketId: ticketGrant.ticketId,
    ticketTtlSec: streamOwnershipService.getHlsPlaybackTicketTtlSeconds(),
  });

  return {
    playback_ticket: ticketGrant.ticketId,
  };
};
