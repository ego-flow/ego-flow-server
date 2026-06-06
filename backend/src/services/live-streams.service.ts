import { RecordingSessionIngestType, RecordingSessionStatus } from "@prisma/client";

import { STREAM_ACTIVE_SET_KEY } from "../constants/stream/stream-constants";
import { runtimeConfig as env } from "../config/runtime";
import { Conflict, NotFound } from "../lib/errors";
import { redis } from "../lib/redis";
import {
  extractRepositoryNameFromStreamPath,
  normalizeStreamPath,
} from "../lib/stream-paths";
import { streamRecordingKey } from "../lib/stream-keys";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import type { AppUserRole } from "../types/auth";
import type { RecordingSessionLiveCache } from "../types/stream";
import { repositoryAccessService } from "./repository-access.service";
import { repositoryService } from "./repository.service";
import { streamOwnershipService } from "./stream-ownership.service";

/**
 * /live-streams route use-case orchestration.
 *
 * Live 목록/상세/HLS playback ticket 발급처럼 dashboard와 Python client가 공유하는
 * live playback surface를 담당한다.
 */
export class LiveStreamsService {
  /**
   * [Live stream 목록 - Redis read-only]
   */
  async listLiveStreams(requestUserId: string, requestUserRole: AppUserRole) {
    const accessibleRepoIds = await repositoryService.listAccessibleRepositoryIds(
      requestUserId,
      requestUserRole,
      "live.list",
    );
    const activeIds = await redis.smembers(STREAM_ACTIVE_SET_KEY);

    if (activeIds.length === 0) {
      return [];
    }

    const cacheRecords = await redis.mget(...activeIds.map(streamRecordingKey));
    const liveCaches = cacheRecords
      .map((record, index) => {
        const cache = this.parseLiveCache(record);
        if (!cache) {
          return null;
        }
        return { recordingSessionId: activeIds[index]!, cache };
      })
      .filter((entry): entry is { recordingSessionId: string; cache: RecordingSessionLiveCache } => Boolean(entry));

    const visibleCaches = liveCaches.filter(
      ({ cache }) => !accessibleRepoIds || accessibleRepoIds.has(cache.repositoryId),
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
        stream_path: this.buildStreamPath(cache.repositoryName, recordingSessionId),
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
  }

  /**
   * [Live stream 상세]
   */
  async getLiveStreamDetail(
    recordingSessionId: string,
    requestUserId: string,
    requestUserRole: AppUserRole,
  ) {
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
    const activeStreamPaths = playbackAvailable ? await this.getActiveStreamPaths() : null;
    const playbackReady = playbackAvailable
      ? activeStreamPaths
        ? activeStreamPaths.has(normalizeStreamPath(session.streamPath))
        : true
      : false;
    const liveCache = this.parseLiveCache(await redis.get(streamRecordingKey(recordingSessionId)));
    const httpProgress =
      session.ingestType === RecordingSessionIngestType.HTTP &&
      liveCache?.status === "STREAMING" &&
      liveCache.repositoryId === session.repositoryId
        ? {
            bytes_received: liveCache.bytesReceived ?? null,
            last_sequence: liveCache.lastSequence ?? null,
            last_chunk_at: liveCache.lastChunkAt ? new Date(liveCache.lastChunkAt).toISOString() : null,
          }
        : {
            bytes_received: null,
            last_sequence: null,
            last_chunk_at: null,
          };

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
  }

  async issueHlsPlaybackTicket(
    recordingSessionId: string,
    requestUserId: string,
    requestUserRole: AppUserRole,
  ) {
    const rawCache = await redis.get(streamRecordingKey(recordingSessionId));
    const liveCache = this.parseLiveCache(rawCache);
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

    const streamPath = this.buildStreamPath(liveCache.repositoryName, recordingSessionId);
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
  }

  private buildStreamPath(repositoryName: string, recordingSessionId: string) {
    return `live/${repositoryName}/${recordingSessionId}`;
  }

  private async getActiveStreamPaths(): Promise<Set<string> | null> {
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
  }

  private parseLiveCache(raw: string | null): RecordingSessionLiveCache | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as RecordingSessionLiveCache;
    } catch (_error) {
      return null;
    }
  }
}

export const liveStreamsService = new LiveStreamsService();
