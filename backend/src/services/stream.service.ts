import { randomUUID } from "crypto";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { env } from "../config/env";
import type { StreamRegisterInput } from "../schemas/stream.schema";
import type { StreamSessionCache } from "../types/stream";

const SESSION_TTL_SECONDS = 24 * 60 * 60;

const streamSessionKey = (userId: string, videoKey: string) => `stream:${userId}:${videoKey}`;
const streamPathKey = (videoKey: string) => `stream:path:${videoKey}`;

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

const getTargetDirectory = async (): Promise<string> => {
  const setting = await prisma.setting.findUnique({
    where: { key: "target_directory" },
  });
  return setting?.value || env.TARGET_DIRECTORY;
};

const getAllSessionKeys = async (): Promise<string[]> => {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, foundKeys] = await redis.scan(cursor, "MATCH", "stream:*:*", "COUNT", 200);
    cursor = nextCursor;
    keys.push(...foundKeys.filter((key) => !key.startsWith("stream:path:")));
  } while (cursor !== "0");
  return keys;
};

export class StreamService {
  async registerSession(userId: string, input: StreamRegisterInput, userJwt: string) {
    const targetDirectory = await getTargetDirectory();
    const session: StreamSessionCache = {
      userId,
      videoKey: input.video_key,
      ...(input.device_type ? { deviceType: input.device_type } : {}),
      targetDirectory,
      registeredAt: new Date().toISOString(),
      sessionId: randomUUID(),
    };

    const sessionKey = streamSessionKey(userId, input.video_key);
    await Promise.all([
      redis.set(sessionKey, serializeSession(session), "EX", SESSION_TTL_SECONDS),
      redis.set(streamPathKey(input.video_key), sessionKey, "EX", SESSION_TTL_SECONDS),
    ]);

    const base = env.RTMP_BASE_URL.replace(/\/+$/, "");
    return {
      video_key: input.video_key,
      rtmp_url: `${base}/${input.video_key}?user=${encodeURIComponent(userId)}&pass=${encodeURIComponent(userJwt)}`,
      status: "ready" as const,
    };
  }

  async listActiveSessions(requestUserId: string, requestUserRole: "admin" | "user") {
    const keys = await getAllSessionKeys();
    if (keys.length === 0) {
      return [];
    }

    const values = await redis.mget(keys);
    const parsed = values.map(parseSession).filter((value): value is StreamSessionCache => Boolean(value));

    const visible =
      requestUserRole === "admin" ? parsed : parsed.filter((session) => session.userId === requestUserId);

    const activeVideoKeys = await this.getActiveVideoKeys();
    const activeVisible = activeVideoKeys
      ? visible.filter((session) => activeVideoKeys.has(session.videoKey))
      : visible.filter((session) => !session.stoppedAt);

    const hlsBase = env.HLS_BASE_URL.replace(/\/+$/, "");
    return activeVisible
      .sort((a, b) => (a.registeredAt > b.registeredAt ? -1 : 1))
      .map((session) => ({
        video_key: session.videoKey,
        user_id: session.userId,
        device_type: session.deviceType ?? null,
        hls_url: `${hlsBase}/live/${session.videoKey}/index.m3u8`,
        registered_at: session.registeredAt,
      }));
  }

  async stopSession(requestUserId: string, requestUserRole: "admin" | "user", videoKey: string) {
    const pathKey = streamPathKey(videoKey);
    const sessionKey = await redis.get(pathKey);
    if (!sessionKey) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    const sessionRaw = await redis.get(sessionKey);
    const session = parseSession(sessionRaw);
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    if (requestUserRole !== "admin" && session.userId !== requestUserId) {
      throw new AppError(403, "FORBIDDEN", "You do not have access to this stream session.");
    }

    if (session.stoppedAt) {
      return {
        video_key: session.videoKey,
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
      video_key: session.videoKey,
      status: "stopping" as const,
    };
  }

  async consumeSessionForRecordingPath(streamPath: string) {
    const videoKey = this.extractVideoKey(streamPath);
    const pathSessionKey = await redis.get(streamPathKey(videoKey));
    if (!pathSessionKey) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    const sessionRaw = await redis.get(pathSessionKey);
    const session = parseSession(sessionRaw);
    if (!session) {
      throw new AppError(404, "NOT_FOUND", "Active stream session not found.");
    }

    await Promise.all([redis.del(pathSessionKey), redis.del(streamPathKey(videoKey))]);

    return {
      videoKey,
      session,
    };
  }

  private extractVideoKey(streamPath: string): string {
    const normalized = streamPath.trim().replace(/^\/+/, "");
    const parts = normalized.split("/");
    if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream path format.");
    }
    return parts[1];
  }

  private async getActiveVideoKeys(): Promise<Set<string> | null> {
    const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

    try {
      const response = await fetch(`${baseUrl}/v3/paths/list`);
      if (!response.ok) {
        throw new Error(`MediaMTX API responded with ${response.status}`);
      }

      const payload = (await response.json()) as MediaMtxPathsListResponse;
      const activeVideoKeys = new Set<string>();

      for (const item of payload.items ?? []) {
        if (typeof item.name !== "string") {
          continue;
        }

        try {
          activeVideoKeys.add(this.extractVideoKey(item.name));
        } catch (_error) {
          // Ignore non-live paths and keep scanning.
        }
      }

      return activeVideoKeys;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[streams] failed to query MediaMTX active paths: ${message}`);
      return null;
    }
  }
}

export const streamService = new StreamService();
