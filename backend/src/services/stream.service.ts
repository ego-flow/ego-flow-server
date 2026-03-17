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

    const hlsBase = env.HLS_BASE_URL.replace(/\/+$/, "");
    return visible
      .sort((a, b) => (a.registeredAt > b.registeredAt ? -1 : 1))
      .map((session) => ({
        video_key: session.videoKey,
        user_id: session.userId,
        device_type: session.deviceType ?? null,
        hls_url: `${hlsBase}/live/${session.videoKey}/index.m3u8`,
        registered_at: session.registeredAt,
      }));
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
}

export const streamService = new StreamService();
