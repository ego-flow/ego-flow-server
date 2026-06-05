import crypto from "crypto";

import {
  DASHBOARD_SESSION_HASH_ALGORITHM,
  DASHBOARD_SESSION_KEY_PREFIX,
  DASHBOARD_SESSION_LAST_USED_UPDATE_INTERVAL_MS,
  DASHBOARD_SESSION_RANDOM_BYTES,
  DASHBOARD_SESSION_REMEMBERED_TTL_MS,
  DASHBOARD_SESSION_SHORT_TTL_MS,
  DASHBOARD_SESSION_TOKEN_PREFIX,
} from "../constants/auth/auth-constants";
import { redis } from "../lib/redis";
import { userRepository } from "../repositories/user.repository";
import type { AuthenticatedUser } from "../types/auth";
import { createPrefixedRandomToken, hashValue } from "../utils/crypto";

interface DashboardSessionRecord {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

const createRawSessionToken = () =>
  createPrefixedRandomToken(DASHBOARD_SESSION_TOKEN_PREFIX, DASHBOARD_SESSION_RANDOM_BYTES);

const hashSessionToken = (rawToken: string) => hashValue(rawToken, DASHBOARD_SESSION_HASH_ALGORITHM);

const sessionKey = (rawToken: string) => `${DASHBOARD_SESSION_KEY_PREFIX}${hashSessionToken(rawToken)}`;

const shouldUpdateLastUsedAt = (lastUsedAt: number) =>
  Date.now() - lastUsedAt >= DASHBOARD_SESSION_LAST_USED_UPDATE_INTERVAL_MS;

const ttlSecondsUntil = (expiresAt: number) => Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));

const parseSessionRecord = (raw: string | null): DashboardSessionRecord | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DashboardSessionRecord>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.lastUsedAt !== "number" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }

    return {
      sessionId: parsed.sessionId,
      userId: parsed.userId,
      createdAt: parsed.createdAt,
      lastUsedAt: parsed.lastUsedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
};

export class DashboardSessionService {
  async createSession(userId: string, rememberMe: boolean) {
    const rawToken = createRawSessionToken();
    const now = Date.now();
    const expiresAt = now + (rememberMe ? DASHBOARD_SESSION_REMEMBERED_TTL_MS : DASHBOARD_SESSION_SHORT_TTL_MS);
    const sessionId = crypto.randomUUID();
    const record: DashboardSessionRecord = {
      sessionId,
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt,
    };

    await redis.set(sessionKey(rawToken), JSON.stringify(record), "EX", ttlSecondsUntil(expiresAt));

    return {
      id: sessionId,
      token: rawToken,
      expiresAt: new Date(expiresAt),
      persistent: rememberMe,
    };
  }

  async verifySession(rawToken: string): Promise<({ sessionId: string } & AuthenticatedUser) | null> {
    if (
      !rawToken.startsWith(DASHBOARD_SESSION_TOKEN_PREFIX) ||
      rawToken.length !== DASHBOARD_SESSION_TOKEN_PREFIX.length + DASHBOARD_SESSION_RANDOM_BYTES * 2
    ) {
      return null;
    }

    const key = sessionKey(rawToken);
    const session = parseSessionRecord(await redis.get(key));
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      void this.revokeSession(rawToken);
      return null;
    }

    const authenticatedUser = await userRepository.findActiveAuthenticatedUser(session.userId);
    if (!authenticatedUser) {
      return null;
    }

    if (shouldUpdateLastUsedAt(session.lastUsedAt)) {
      const nextRecord = {
        ...session,
        lastUsedAt: Date.now(),
      } satisfies DashboardSessionRecord;
      void redis.set(key, JSON.stringify(nextRecord), "EX", ttlSecondsUntil(session.expiresAt)).catch((error) => {
        console.warn("[dashboard-session] failed to update last_used_at", {
          sessionId: session.sessionId,
          userId: session.userId,
          error,
        });
      });
    }

    return {
      sessionId: session.sessionId,
      ...authenticatedUser,
    };
  }

  async revokeSession(rawToken: string) {
    if (!rawToken.startsWith(DASHBOARD_SESSION_TOKEN_PREFIX)) {
      return;
    }

    await redis.del(sessionKey(rawToken));
  }
}

export const dashboardSessionService = new DashboardSessionService();
