import { randomUUID } from "crypto";

import { AppError } from "../lib/errors";
import { redis } from "../lib/redis";
import { getTargetDirectory } from "../lib/storage";
import { env } from "../config/env";
import type { AppUserRole } from "../types/auth";
import type { StreamRegisterInput } from "../schemas/stream.schema";
import type { StreamSessionCache } from "../types/stream";
import { repositoryService } from "./repository.service";

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const REGISTRATION_GRACE_PERIOD_MS = 30 * 1000;

const streamSessionKey = (repositoryId: string) => `stream:repo:${repositoryId}`;
const streamPathKey = (repoName: string) => `stream:path:${repoName}`;

const serializeSession = (value: StreamSessionCache) => JSON.stringify(value);

const parseSession = (value: string | null): StreamSessionCache | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as StreamSessionCache;
  } catch (_error) {
    return null;
  }
};

interface MediaMtxPathsListResponse {
  items?: Array<{
    name?: unknown;
  }>;
}

export class StreamService {
  async registerSession(
    userId: string,
    userRole: AppUserRole,
    input: StreamRegisterInput,
    userJwt: string,
  ) {
    const access = await repositoryService.assertRepositoryAccess(userId, userRole, input.repository_id, "maintain");
    await this.ensureRepositoryPathIsAvailable(access.repository.id, access.repository.name);

    const targetDirectory = getTargetDirectory();
    const session: StreamSessionCache = {
      userId,
      repositoryId: access.repository.id,
      repositoryName: access.repository.name,
      ownerId: access.repository.ownerId,
      ...(input.device_type ? { deviceType: input.device_type } : {}),
      targetDirectory,
      registeredAt: new Date().toISOString(),
      sessionId: randomUUID(),
    };

    const sessionKey = streamSessionKey(access.repository.id);
    await Promise.all([
      redis.set(sessionKey, serializeSession(session), "EX", SESSION_TTL_SECONDS),
      redis.set(streamPathKey(access.repository.name), sessionKey, "EX", SESSION_TTL_SECONDS),
    ]);

    const base = env.RTMP_BASE_URL.replace(/\/+$/, "");
    return {
      repository_id: access.repository.id,
      repository_name: access.repository.name,
      rtmp_url: `${base}/${access.repository.name}?user=${encodeURIComponent(userId)}&pass=${encodeURIComponent(userJwt)}`,
      status: "ready" as const,
    };
  }

  async listActiveSessions(requestUserId: string, requestUserRole: AppUserRole) {
    const keys = await this.getAllSessionKeys();
    if (keys.length === 0) {
      return [];
    }

    const values = await redis.mget(keys);
    const sessions = values.map(parseSession).filter((value): value is StreamSessionCache => Boolean(value));
    const accessResults = await Promise.all(
      sessions.map(async (session) => ({
        session,
        access: await repositoryService.getRepositoryAccess(requestUserId, requestUserRole, session.repositoryId),
      })),
    );

    const visible = accessResults
      .filter((result): result is { session: StreamSessionCache; access: NonNullable<typeof result.access> } => Boolean(result.access))
      .map((result) => result.session);

    const activeRepoNames = await this.getActiveRepositoryNames();
    const activeVisible = activeRepoNames
      ? visible.filter((session) => activeRepoNames.has(session.repositoryName))
      : visible.filter((session) => !session.stoppedAt);

    const hlsBase = env.HLS_BASE_URL.replace(/\/+$/, "");
    return activeVisible
      .sort((a, b) => (a.registeredAt > b.registeredAt ? -1 : 1))
      .map((session) => ({
        repository_id: session.repositoryId,
        repository_name: session.repositoryName,
        owner_id: session.ownerId,
        user_id: session.userId,
        device_type: session.deviceType ?? null,
        hls_url: `${hlsBase}/live/${session.repositoryName}/index.m3u8`,
        registered_at: session.registeredAt,
      }));
  }

  async stopSession(requestUserId: string, requestUserRole: AppUserRole, repositoryId: string) {
    await repositoryService.assertRepositoryAccess(requestUserId, requestUserRole, repositoryId, "maintain");

    const sessionKey = streamSessionKey(repositoryId);
    const sessionRaw = await redis.get(sessionKey);
    const session = parseSession(sessionRaw);
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    if (session.stoppedAt) {
      return {
        repository_id: session.repositoryId,
        status: "stopping" as const,
      };
    }

    const nextSession: StreamSessionCache = {
      ...session,
      stoppedAt: new Date().toISOString(),
    };

    const ttlSeconds = await redis.ttl(sessionKey);
    if (ttlSeconds > 0) {
      await redis.set(sessionKey, serializeSession(nextSession), "EX", ttlSeconds);
    } else {
      await redis.set(sessionKey, serializeSession(nextSession));
    }

    return {
      repository_id: session.repositoryId,
      status: "stopping" as const,
    };
  }

  async findSessionByStreamPath(streamPath: string): Promise<StreamSessionCache | null> {
    const repoName = this.extractRepositoryName(streamPath);
    const sessionKey = await redis.get(streamPathKey(repoName));
    if (!sessionKey) {
      return null;
    }

    return parseSession(await redis.get(sessionKey));
  }

  async getSessionForRecordingPath(streamPath: string) {
    const repoName = this.extractRepositoryName(streamPath);
    const pathSessionKey = await redis.get(streamPathKey(repoName));
    if (!pathSessionKey) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    const sessionRaw = await redis.get(pathSessionKey);
    const session = parseSession(sessionRaw);
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    return {
      repositoryName: repoName,
      session,
    };
  }

  private extractRepositoryName(streamPath: string): string {
    const normalized = streamPath.trim().replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream path format.");
    }

    return parts[1];
  }

  private async ensureRepositoryPathIsAvailable(repositoryId: string, repositoryName: string) {
    const repositorySessionKey = streamSessionKey(repositoryId);
    const repositoryPathKey = streamPathKey(repositoryName);
    const [sessionByRepo, sessionByPath, activeRepoNames] = await Promise.all([
      redis.get(repositorySessionKey),
      redis.get(repositoryPathKey),
      this.getActiveRepositoryNames(),
    ]);

    if (activeRepoNames?.has(repositoryName)) {
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    if (!sessionByRepo && !sessionByPath) {
      return;
    }

    if (!activeRepoNames) {
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const parsedSessionByRepo = parseSession(sessionByRepo);
    const registeredAtMs = parsedSessionByRepo ? Date.parse(parsedSessionByRepo.registeredAt) : Number.NaN;
    if (Number.isFinite(registeredAtMs) && Date.now() - registeredAtMs < REGISTRATION_GRACE_PERIOD_MS) {
      throw new AppError(409, "CONFLICT", "Repository already has an active stream.");
    }

    const staleKeys = new Set<string>([repositorySessionKey, repositoryPathKey]);
    if (sessionByPath?.startsWith("stream:repo:")) {
      staleKeys.add(sessionByPath);
    }

    await redis.del(...Array.from(staleKeys));
  }

  private async getAllSessionKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, foundKeys] = await redis.scan(cursor, "MATCH", "stream:repo:*", "COUNT", 200);
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== "0");
    return keys;
  }

  private async getActiveRepositoryNames(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as MediaMtxPathsListResponse;
      const activeRepositoryNames = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }

        try {
          activeRepositoryNames.add(this.extractRepositoryName(item.name));
        } catch (_error) {
          // Ignore non-live paths and keep scanning.
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
