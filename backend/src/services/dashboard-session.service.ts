import crypto from "crypto";

import { redis } from "../lib/redis";
import type { AuthenticatedUser } from "../types/auth";
import { adminService } from "./admin.service";

export const DASHBOARD_SESSION_COOKIE_NAME = "egoflow_session";

const SESSION_PREFIX = "efs_";
const SESSION_RANDOM_BYTES = 32;
const SESSION_HASH_ALGORITHM = "sha256";
const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_KEY_PREFIX = "dashboard:session:";

interface DashboardSessionRecord {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

const createRawSessionToken = () => `${SESSION_PREFIX}${crypto.randomBytes(SESSION_RANDOM_BYTES).toString("hex")}`;

const hashSessionToken = (rawToken: string) =>
  crypto.createHash(SESSION_HASH_ALGORITHM).update(rawToken).digest("hex");

const sessionKey = (rawToken: string) => `${SESSION_KEY_PREFIX}${hashSessionToken(rawToken)}`;

const shouldUpdateLastUsedAt = (lastUsedAt: number) => Date.now() - lastUsedAt >= LAST_USED_UPDATE_INTERVAL_MS;

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
    const expiresAt = now + (rememberMe ? REMEMBERED_SESSION_TTL_MS : SHORT_SESSION_TTL_MS);
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
    if (!rawToken.startsWith(SESSION_PREFIX) || rawToken.length !== SESSION_PREFIX.length + SESSION_RANDOM_BYTES * 2) {
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

    const authenticatedUser = await adminService.getAuthenticatedUser(session.userId);
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
    if (!rawToken.startsWith(SESSION_PREFIX)) {
      return;
    }

    await redis.del(sessionKey(rawToken));
  }
}

export const dashboardSessionService = new DashboardSessionService();
