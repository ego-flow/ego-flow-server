import { RecordingSessionStatus } from "@prisma/client";

import { AppError } from "../lib/errors";
import { redis } from "../lib/redis";
import { getTargetDirectory } from "../lib/storage";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import type { AppUserRole } from "../types/auth";
import type { StreamRegisterInput } from "../schemas/stream.schema";
import type { RecordingSessionLiveCache } from "../types/stream";
import { repositoryService } from "./repository.service";
import { recordingSessionService } from "./recording-session.service";

const RECONCILE_INTERVAL_MS = 15 * 1000;

const streamRepoKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;
const streamRecordingKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}`;

export class StreamService {
  private reconcileTimer?: NodeJS.Timeout;

  async registerSession(
    userId: string,
    userRole: AppUserRole,
    input: StreamRegisterInput,
    userJwt: string,
  ) {
    const access = await repositoryService.assertRepositoryAccess(userId, userRole, input.repository_id, "maintain");
    await this.ensureRepositoryPathIsAvailable(access.repository.id, access.repository.name);

    const streamPath = `live/${access.repository.name}`;
    const session = await recordingSessionService.createSession({
      repositoryId: access.repository.id,
      ownerId: access.repository.ownerId,
      userId,
      ...(input.device_type ? { deviceType: input.device_type } : {}),
      streamPath,
      targetDirectory: getTargetDirectory(),
    });

    const base = env.RTMP_BASE_URL.replace(/\/+$/, "");
    return {
      recording_session_id: session.id,
      repository_id: access.repository.id,
      repository_name: access.repository.name,
      rtmp_url: `${base}/${access.repository.name}?user=${encodeURIComponent(userId)}&pass=${encodeURIComponent(userJwt)}`,
      status: "ready" as const,
    };
  }

  async listActiveSessions(requestUserId: string, requestUserRole: AppUserRole) {
    const sessions = await prisma.recordingSession.findMany({
      where: { status: RecordingSessionStatus.STREAMING },
    });

    if (sessions.length === 0) {
      return [];
    }

    const visibleResults = await Promise.all(
      sessions.map(async (session) => ({
        session,
        access: await repositoryService.getRepositoryAccess(requestUserId, requestUserRole, session.repositoryId),
      })),
    );

    const visible = visibleResults
      .filter((result): result is { session: (typeof sessions)[0]; access: NonNullable<typeof result.access> } =>
        Boolean(result.access),
      )
      .map((result) => result.session);

    const activeRepoNames = await this.getActiveRepositoryNames();
    const activeVisible = activeRepoNames
      ? visible.filter((session) => {
          const repoName = recordingSessionService.extractRepositoryName(session.streamPath);
          return activeRepoNames.has(repoName);
        })
      : visible;

    const hlsBase = env.HLS_BASE_URL.replace(/\/+$/, "");
    return activeVisible
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .map((session) => {
        const repoName = recordingSessionService.extractRepositoryName(session.streamPath);
        return {
          repository_id: session.repositoryId,
          repository_name: repoName,
          owner_id: session.ownerId,
          user_id: session.userId,
          device_type: session.deviceType ?? null,
          hls_url: `${hlsBase}/live/${repoName}/index.m3u8`,
          registered_at: session.createdAt.toISOString(),
        };
      });
  }

  async findLiveSessionByStreamPath(streamPath: string): Promise<RecordingSessionLiveCache | null> {
    const cache = await recordingSessionService.getLiveCacheByPath(streamPath);
    if (!cache) {
      return null;
    }

    if (cache.status === "FINALIZING") {
      return null;
    }

    return cache;
  }

  async activateSession(recordingSessionId: string): Promise<RecordingSessionLiveCache | null> {
    const cachedStr = await redis.get(streamRecordingKey(recordingSessionId));
    if (!cachedStr) {
      return null;
    }

    let cache: RecordingSessionLiveCache;
    try {
      cache = JSON.parse(cachedStr) as RecordingSessionLiveCache;
    } catch (_error) {
      return null;
    }

    if (cache.status === "FINALIZING") {
      return null;
    }

    await recordingSessionService.promoteLivePointerTtl(recordingSessionId);
    return cache;
  }

  startReconcileLoop() {
    if (this.reconcileTimer) {
      return;
    }

    this.reconcileTimer = setInterval(() => {
      void recordingSessionService.reconcileSessions().catch((error) => {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn(`[streams] reconcile failed: ${message}`);
      });
    }, RECONCILE_INTERVAL_MS);

    this.reconcileTimer.unref();
  }

  private async ensureRepositoryPathIsAvailable(repositoryId: string, repositoryName: string) {
    const activeRepoNames = await this.getActiveRepositoryNames();
    if (activeRepoNames?.has(repositoryName)) {
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const existingSession = await prisma.recordingSession.findFirst({
      where: {
        repositoryId,
        status: {
          in: [RecordingSessionStatus.PENDING, RecordingSessionStatus.STREAMING, RecordingSessionStatus.STOP_REQUESTED],
        },
      },
    });

    if (existingSession) {
      if (existingSession.status === RecordingSessionStatus.PENDING) {
        const age = Date.now() - existingSession.createdAt.getTime();
        if (age > 90 * 1000) {
          await prisma.recordingSession.update({
            where: { id: existingSession.id },
            data: {
              status: RecordingSessionStatus.ABORTED,
              endReason: "REGISTRATION_TIMEOUT",
              finalizedAt: new Date(),
            },
          });
          const repoName = recordingSessionService.extractRepositoryName(existingSession.streamPath);
          await redis.del(streamRepoKey(repositoryId));
          await redis.del(streamPathKey(repoName));
          await redis.del(streamRecordingKey(existingSession.id));
          return;
        }
      }

      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const [repoSessionId, pathSessionId] = await Promise.all([
      redis.get(streamRepoKey(repositoryId)),
      redis.get(streamPathKey(repositoryName)),
    ]);

    const staleIds = Array.from(new Set([repoSessionId, pathSessionId].filter((v): v is string => Boolean(v))));
    for (const staleId of staleIds) {
      await redis.del(streamRepoKey(repositoryId));
      await redis.del(streamPathKey(repositoryName));
      await redis.del(streamRecordingKey(staleId));
    }
  }

  private async getActiveRepositoryNames(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
      const activeRepositoryNames = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }

        try {
          activeRepositoryNames.add(recordingSessionService.extractRepositoryName(item.name));
        } catch (_error) {
          // Ignore non-live paths.
        }
      }

      return activeRepositoryNames;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[streams] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }
}

export const streamService = new StreamService();
