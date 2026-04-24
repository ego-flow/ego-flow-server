import crypto from "crypto";

import { redis } from "../lib/redis";

const PLAYBACK_TOKEN_PREFIX = "efp_";
const PLAYBACK_TOKEN_RANDOM_BYTES = 24;
const PLAYBACK_TOKEN_TTL_SECONDS = 5 * 60;

export interface PlaybackTokenRecord {
  userId: string;
  repositoryId: string;
  recordingSessionId: string;
  streamPath: string;
}

const playbackTokenKey = (token: string) => `playback:token:${token}`;

const createPlaybackToken = () =>
  `${PLAYBACK_TOKEN_PREFIX}${crypto.randomBytes(PLAYBACK_TOKEN_RANDOM_BYTES).toString("hex")}`;

export class PlaybackTokenService {
  async issueToken(record: PlaybackTokenRecord) {
    const token = createPlaybackToken();
    await redis.set(playbackTokenKey(token), JSON.stringify(record), "EX", PLAYBACK_TOKEN_TTL_SECONDS);
    return {
      token,
      expires_in_seconds: PLAYBACK_TOKEN_TTL_SECONDS,
    };
  }

  async verifyToken(token: string): Promise<PlaybackTokenRecord | null> {
    if (!token.startsWith(PLAYBACK_TOKEN_PREFIX)) {
      return null;
    }

    const raw = await redis.get(playbackTokenKey(token));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PlaybackTokenRecord>;
      if (
        typeof parsed.userId !== "string" ||
        typeof parsed.repositoryId !== "string" ||
        typeof parsed.recordingSessionId !== "string" ||
        typeof parsed.streamPath !== "string"
      ) {
        return null;
      }

      return {
        userId: parsed.userId,
        repositoryId: parsed.repositoryId,
        recordingSessionId: parsed.recordingSessionId,
        streamPath: parsed.streamPath,
      };
    } catch {
      return null;
    }
  }
}

export const playbackTokenService = new PlaybackTokenService();
