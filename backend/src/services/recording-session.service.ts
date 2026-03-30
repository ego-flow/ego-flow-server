import { RecordingSessionStatus, RecordingSessionEndReason, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { env } from "../config/env";
import { processingService } from "./processing.service";
import type {
  RecordingSessionLiveCache,
  RecordingFinalizeJobData,
} from "../types/stream";
import type {
  StreamReadyHookInput,
  StreamNotReadyHookInput,
  SegmentCreateHookInput,
  SegmentCompleteHookInput,
} from "../schemas/stream.schema";

const REGISTRATION_TTL_SECONDS = 90;
const ACTIVE_TTL_SECONDS = 24 * 60 * 60;
const FINALIZE_GRACE_PERIOD_MS = 30 * 1000;
const FINALIZE_MAX_WAIT_MS = 2 * 60 * 1000;

const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
const streamSourceKey = (sourceId: string) => `stream:source:${sourceId}`;
const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

export class RecordingSessionService {
  async createSession(params: {
    repositoryId: string;
    ownerId: string;
    userId: string;
    deviceType?: string;
    streamPath: string;
    targetDirectory: string;
  }) {
    const session = await prisma.recordingSession.create({
      data: {
        repositoryId: params.repositoryId,
        ownerId: params.ownerId,
        userId: params.userId,
        deviceType: params.deviceType ?? null,
        streamPath: params.streamPath,
        status: RecordingSessionStatus.PENDING,
        targetDirectory: params.targetDirectory,
      },
    });

    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId: session.id,
      repositoryId: session.repositoryId,
      repositoryName: this.extractRepositoryName(session.streamPath),
      ownerId: session.ownerId,
      userId: session.userId,
      targetDirectory: session.targetDirectory,
      status: "PENDING",
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    const repoName = liveCache.repositoryName;
    await redis
      .multi()
      .set(streamRecordingKey(session.id), JSON.stringify(liveCache), "EX", REGISTRATION_TTL_SECONDS)
      .set(streamRepoKey(session.repositoryId), session.id, "EX", REGISTRATION_TTL_SECONDS)
      .set(streamPathKey(repoName), session.id, "EX", REGISTRATION_TTL_SECONDS)
      .exec();

    return session;
  }

  async handleStreamReady(input: StreamReadyHookInput) {
    const repoName = this.extractRepositoryName(input.path);
    const recordingSessionId = await this.resolveRecordingSessionIdForReady(input.path, input.query);
    if (!recordingSessionId) {
      console.warn(`[recording-session] stream-ready: no session found for path ${input.path}`);
      return;
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session || session.status !== RecordingSessionStatus.PENDING) {
      console.warn(`[recording-session] stream-ready: session ${recordingSessionId} not in PENDING state`);
      return;
    }

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STREAMING,
        readyAt: new Date(),
        sourceId: input.source_id,
        sourceType: input.source_type,
      },
    });

    const liveCache: RecordingSessionLiveCache = {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: repoName,
      ownerId: session.ownerId,
      userId: session.userId,
      targetDirectory: session.targetDirectory,
      status: "STREAMING",
      sourceId: input.source_id,
      sourceType: input.source_type,
      readyAt: new Date().toISOString(),
    };
    if (session.deviceType) {
      liveCache.deviceType = session.deviceType;
    }

    await redis
      .multi()
      .set(streamRecordingKey(recordingSessionId), JSON.stringify(liveCache), "EX", ACTIVE_TTL_SECONDS)
      .set(streamRepoKey(session.repositoryId), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamPathKey(repoName), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .set(streamSourceKey(input.source_id), recordingSessionId, "EX", ACTIVE_TTL_SECONDS)
      .exec();
  }

  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    let recordingSessionId = await redis.get(streamSourceKey(input.source_id));
    if (!recordingSessionId) {
      const repoName = this.extractRepositoryName(input.path);
      recordingSessionId = await redis.get(streamPathKey(repoName));
    }
    if (!recordingSessionId) {
      const session = await prisma.recordingSession.findFirst({
        where: {
          streamPath: input.path,
          status: {
            in: [RecordingSessionStatus.STREAMING, RecordingSessionStatus.STOP_REQUESTED],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      recordingSessionId = session?.id ?? null;
    }
    if (!recordingSessionId) {
      console.warn(`[recording-session] stream-not-ready: no session found for path ${input.path}`);
      return;
    }

    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      console.warn(`[recording-session] stream-not-ready: session ${recordingSessionId} not found in DB`);
      return;
    }

    if (
      session.status !== RecordingSessionStatus.STREAMING &&
      session.status !== RecordingSessionStatus.STOP_REQUESTED
    ) {
      console.warn(
        `[recording-session] stream-not-ready: session ${recordingSessionId} in ${session.status}, skipping`,
      );
      return;
    }

    const endReason =
      session.status === RecordingSessionStatus.STOP_REQUESTED
        ? session.endReason
        : RecordingSessionEndReason.UNEXPECTED_DISCONNECT;

    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.FINALIZING,
        notReadyAt: new Date(),
        ...(session.endReason ? {} : { endReason }),
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    await this.clearLivePointers(recordingSessionId, session.repositoryId, repoName, session.sourceId ?? undefined);

    await this.tryEnqueueFinalize(recordingSessionId);
  }

  async handleSegmentCreate(input: SegmentCreateHookInput) {
    let recordingSessionId = await this.resolveRecordingSessionIdForSegment(input.path);
    if (!recordingSessionId) {
      console.warn(`[recording-session] segment-create: no session found for path ${input.path}`);
      return;
    }

    const maxSeq = await prisma.recordingSegment.aggregate({
      where: { recordingSessionId },
      _max: { sequence: true },
    });
    const nextSequence = (maxSeq._max.sequence ?? -1) + 1;

    await prisma.recordingSegment.upsert({
      where: {
        recordingSessionId_rawPath: {
          recordingSessionId,
          rawPath: input.segment_path,
        },
      },
      create: {
        recordingSessionId,
        sequence: nextSequence,
        rawPath: input.segment_path,
        status: RecordingSegmentStatus.WRITING,
      },
      update: {},
    });
  }

  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    const segment = await prisma.recordingSegment.findFirst({
      where: { rawPath: input.segment_path },
    });

    if (!segment) {
      const recordingSessionId = await this.resolveRecordingSessionIdForSegment(input.path);
      if (!recordingSessionId) {
        console.warn(`[recording-session] segment-complete: no session found for segment ${input.segment_path}`);
        return;
      }

      const maxSeq = await prisma.recordingSegment.aggregate({
        where: { recordingSessionId },
        _max: { sequence: true },
      });
      const nextSequence = (maxSeq._max.sequence ?? -1) + 1;

      await prisma.recordingSegment.create({
        data: {
          recordingSessionId,
          sequence: nextSequence,
          rawPath: input.segment_path,
          durationSec: input.segment_duration ?? null,
          status: RecordingSegmentStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      const session = await prisma.recordingSession.findUnique({
        where: { id: recordingSessionId },
      });
      if (session?.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(recordingSessionId);
      }
      return;
    }

    await prisma.recordingSegment.update({
      where: { id: segment.id },
      data: {
        status: RecordingSegmentStatus.COMPLETED,
        durationSec: input.segment_duration ?? null,
        completedAt: new Date(),
      },
    });

    const session = await prisma.recordingSession.findUnique({
      where: { id: segment.recordingSessionId },
    });
    if (session?.status === RecordingSessionStatus.FINALIZING) {
      await this.tryEnqueueFinalize(segment.recordingSessionId);
    }
  }

  async requestStop(recordingSessionId: string, reason: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
    });
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    if (
      session.status !== RecordingSessionStatus.PENDING &&
      session.status !== RecordingSessionStatus.STREAMING
    ) {
      throw new AppError(409, "CONFLICT", `Recording session is already in ${session.status} state.`);
    }

    const endReason = reason === "GLASSES_STOP"
      ? RecordingSessionEndReason.GLASSES_STOP
      : RecordingSessionEndReason.USER_STOP;

    const updated = await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STOP_REQUESTED,
        endReason,
        stopRequestedAt: new Date(),
      },
    });

    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (cachedStr) {
      try {
        const cached = JSON.parse(cachedStr) as RecordingSessionLiveCache;
        cached.status = "STOP_REQUESTED";
        cached.stopRequestedAt = new Date().toISOString();
        await redis.set(streamRecordingKey(recordingSessionId), JSON.stringify(cached), "EX", ACTIVE_TTL_SECONDS);
      } catch (_error) {
        // Ignore parse failures.
      }
    }

    return updated;
  }

  async getSessionStatus(recordingSessionId: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      include: {
        _count: { select: { segments: true } },
        video: { select: { id: true } },
      },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    return {
      id: session.id,
      status: session.status,
      end_reason: session.endReason,
      segment_count: session._count.segments,
      video_id: session.video?.id ?? null,
      created_at: session.createdAt.toISOString(),
      ready_at: session.readyAt?.toISOString() ?? null,
      not_ready_at: session.notReadyAt?.toISOString() ?? null,
      finalized_at: session.finalizedAt?.toISOString() ?? null,
    };
  }

  async getSessionRepositoryId(recordingSessionId: string) {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      select: { repositoryId: true },
    });

    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Recording session not found.");
    }

    return session.repositoryId;
  }

  async tryEnqueueFinalize(recordingSessionId: string): Promise<boolean> {
    const session = await prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      include: {
        video: { select: { id: true } },
      },
    });
    if (!session || session.status !== RecordingSessionStatus.FINALIZING) {
      return false;
    }

    const writingCount = await prisma.recordingSegment.count({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.WRITING,
      },
    });

    const finalizeReferenceAt = this.getFinalizeReferenceAt(session);
    const elapsedMs = Date.now() - finalizeReferenceAt.getTime();

    if (writingCount > 0) {
      if (elapsedMs > FINALIZE_MAX_WAIT_MS) {
        await this.markSessionFailed(recordingSessionId, session.endReason);
        console.warn(
          `[recording-session] tryEnqueueFinalize: session ${recordingSessionId} failed — writing segments remained for ${elapsedMs}ms`,
        );
      }
      return false;
    }

    const completedCount = await prisma.recordingSegment.count({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.COMPLETED,
      },
    });

    if (completedCount === 0) {
      if (elapsedMs > FINALIZE_GRACE_PERIOD_MS) {
        await this.markSessionFailed(recordingSessionId, session.endReason);
        console.warn(
          `[recording-session] tryEnqueueFinalize: session ${recordingSessionId} failed — no completed segments after ${elapsedMs}ms`,
        );
      }
      return false;
    }

    const firstSegment = await prisma.recordingSegment.findFirst({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.COMPLETED,
      },
      orderBy: { sequence: "asc" },
    });

    const video = await prisma.video.upsert({
      where: { recordingSessionId: session.id },
      update: {
        rawRecordingPath: firstSegment!.rawPath,
        streamPath: session.streamPath,
        deviceType: session.deviceType,
        ...(session.video ? {} : { status: VideoStatus.PENDING, errorMessage: null }),
      },
      create: {
        repositoryId: session.repositoryId,
        recordingSessionId: session.id,
        rawRecordingPath: firstSegment!.rawPath,
        streamPath: session.streamPath,
        deviceType: session.deviceType,
        status: VideoStatus.PENDING,
      },
    });

    const repoName = this.extractRepositoryName(session.streamPath);
    const payload: RecordingFinalizeJobData = {
      recordingSessionId: session.id,
      videoId: video.id,
      repositoryId: session.repositoryId,
      ownerId: session.ownerId,
      repoName,
      targetDirectory: session.targetDirectory,
    };

    await processingService.enqueueRecordingFinalize(payload);
    return true;
  }

  async reconcileSessions() {
    const activeSessions = await prisma.recordingSession.findMany({
      where: {
        status: {
          in: [
            RecordingSessionStatus.PENDING,
            RecordingSessionStatus.STREAMING,
            RecordingSessionStatus.STOP_REQUESTED,
            RecordingSessionStatus.FINALIZING,
          ],
        },
      },
    });

    if (activeSessions.length === 0) {
      return;
    }

    const activeRepoNames = await this.getActiveRepositoryNames();
    const now = Date.now();

    for (const session of activeSessions) {
      const repoName = this.extractRepositoryName(session.streamPath);

      if (session.status === RecordingSessionStatus.FINALIZING) {
        await this.tryEnqueueFinalize(session.id);
        continue;
      }

      if (session.status === RecordingSessionStatus.PENDING) {
        const age = now - session.createdAt.getTime();
        if (age > REGISTRATION_TTL_SECONDS * 1000) {
          await prisma.recordingSession.update({
            where: { id: session.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: RecordingSessionEndReason.REGISTRATION_TIMEOUT,
              finalizedAt: new Date(),
            },
          });
          await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);
        }
        continue;
      }

      if (activeRepoNames && !activeRepoNames.has(repoName)) {
        await prisma.recordingSession.update({
          where: { id: session.id },
          data: {
            status: RecordingSessionStatus.FINALIZING,
            notReadyAt: new Date(),
            ...(session.endReason ? {} : { endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT }),
          },
        });
        await this.clearLivePointers(session.id, session.repositoryId, repoName, session.sourceId ?? undefined);
        await this.tryEnqueueFinalize(session.id);
      }
    }
  }

  async getLiveCacheByPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    const repoName = this.extractRepositoryName(streamPath);
    const recordingSessionId = await redis.get(streamPathKey(repoName));
    if (!recordingSessionId) {
      return null;
    }

    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return null;
    }

    try {
      return JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return null;
    }
  }

  async promoteLivePointerTtl(recordingSessionId: string) {
    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return;
    }

    let cache: RecordingSessionLiveCache;
    try {
      cache = JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return;
    }

    const repoName = cache.repositoryName;
    const pipeline = redis.multi();
    pipeline.expire(streamRecordingKey(recordingSessionId), ACTIVE_TTL_SECONDS);
    pipeline.expire(streamRepoKey(cache.repositoryId), ACTIVE_TTL_SECONDS);
    pipeline.expire(streamPathKey(repoName), ACTIVE_TTL_SECONDS);
    if (cache.sourceId) {
      pipeline.expire(streamSourceKey(cache.sourceId), ACTIVE_TTL_SECONDS);
    }
    await pipeline.exec();
  }

  private async clearLivePointers(
    recordingSessionId: string,
    repositoryId: string,
    repositoryName: string,
    sourceId?: string,
  ) {
    const keys = [
      streamRepoKey(repositoryId),
      streamPathKey(repositoryName),
      streamRecordingKey(recordingSessionId),
    ];
    if (sourceId) {
      keys.push(streamSourceKey(sourceId));
    }

    for (const key of keys) {
      const value = await redis.get(key);
      if (value === recordingSessionId) {
        await redis.del(key);
      } else if (key === streamRecordingKey(recordingSessionId)) {
        await redis.del(key);
      }
    }
  }

  extractRepositoryName(streamPath: string): string {
    const normalized = streamPath.trim().replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream path format.");
    }
    return parts[1];
  }

  private async resolveRecordingSessionIdForSegment(streamPath: string) {
    const repoName = this.extractRepositoryName(streamPath);
    const liveRecordingSessionId = await redis.get(streamPathKey(repoName));
    if (liveRecordingSessionId) {
      return liveRecordingSessionId;
    }

    const session = await prisma.recordingSession.findFirst({
      where: {
        streamPath,
        status: {
          in: [
            RecordingSessionStatus.FINALIZING,
            RecordingSessionStatus.STOP_REQUESTED,
            RecordingSessionStatus.STREAMING,
          ],
        },
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });

    return session?.id ?? null;
  }

  private async resolveRecordingSessionIdForReady(streamPath: string, query?: string) {
    const repoName = this.extractRepositoryName(streamPath);
    const liveRecordingSessionId = await redis.get(streamPathKey(repoName));
    if (liveRecordingSessionId) {
      return liveRecordingSessionId;
    }

    const queryParams = new URLSearchParams(query ?? "");
    const requestedUserId = queryParams.get("user");
    const session = await prisma.recordingSession.findFirst({
      where: {
        streamPath,
        status: RecordingSessionStatus.PENDING,
        ...(requestedUserId ? { userId: requestedUserId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });

    return session?.id ?? null;
  }

  private getFinalizeReferenceAt(session: {
    notReadyAt: Date | null;
    stopRequestedAt: Date | null;
    readyAt: Date | null;
    createdAt: Date;
  }) {
    return session.notReadyAt ?? session.stopRequestedAt ?? session.readyAt ?? session.createdAt;
  }

  private async markSessionFailed(
    recordingSessionId: string,
    endReason: RecordingSessionEndReason | null,
  ) {
    await prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.FAILED,
        endReason: endReason ?? RecordingSessionEndReason.INTERNAL_ERROR,
        finalizedAt: new Date(),
      },
    });
  }

  private async getActiveRepositoryNames(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const names = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }
        try {
          names.add(this.extractRepositoryName(item.name));
        } catch (_error) {
          // Ignore non-live paths.
        }
      }

      return names;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[recording-session] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }
}

export const recordingSessionService = new RecordingSessionService();
