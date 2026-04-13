import assert from "node:assert/strict";
import crypto from "crypto";
import { beforeEach, test } from "node:test";
import { UserRole } from "@prisma/client";

import { AppError } from "../src/lib/errors";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

type UserRecord = {
  id: string;
  role: UserRole;
  isActive: boolean;
  displayName: string | null;
};

type ApiTokenRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  lastUsedAt: Date | null;
  createdAt: Date;
};

const users = new Map<string, UserRecord>();
const tokens = new Map<string, ApiTokenRecord>();
let tokenSequence = 0;

const cloneDate = (value: Date | null) => (value ? new Date(value) : null);

const findToken = (where: { id?: string; userId?: string; tokenHash?: string }) => {
  for (const token of tokens.values()) {
    if (where.id && token.id === where.id) {
      return token;
    }

    if (where.userId && token.userId === where.userId) {
      return token;
    }

    if (where.tokenHash && token.tokenHash === where.tokenHash) {
      return token;
    }
  }

  return null;
};

const toTokenResult = (token: ApiTokenRecord | null) => {
  if (!token) {
    return null;
  }

  const user = users.get(token.userId) ?? null;

  return {
    id: token.id,
    userId: token.userId,
    name: token.name,
    tokenHash: token.tokenHash,
    lastUsedAt: cloneDate(token.lastUsedAt),
    createdAt: new Date(token.createdAt),
    user: user
      ? {
          id: user.id,
          role: user.role,
          isActive: user.isActive,
          displayName: user.displayName,
        }
      : null,
  };
};

const fakePrisma: any = {
  apiToken: {
    findUnique: async ({ where }: { where: { id?: string; userId?: string; tokenHash?: string } }) =>
      toTokenResult(findToken(where)),
    findMany: async ({ where }: { where?: { userId?: string } }) =>
      Array.from(tokens.values())
        .filter((token) => !where?.userId || token.userId === where.userId)
        .sort((left, right) => left.userId.localeCompare(right.userId) || right.createdAt.getTime() - left.createdAt.getTime())
        .map((token) => toTokenResult(token)),
    create: async ({ data }: { data: { userId: string; name: string; tokenHash: string } }) => {
      const created: ApiTokenRecord = {
        id: `token-${++tokenSequence}`,
        userId: data.userId,
        name: data.name,
        tokenHash: data.tokenHash,
        lastUsedAt: null,
        createdAt: new Date(`2026-04-12T00:00:${String(tokenSequence).padStart(2, "0")}.000Z`),
      };

      tokens.set(created.id, created);
      return toTokenResult(created);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const existing = tokens.get(where.id);
      if (!existing) {
        throw new Error(`Token ${where.id} not found`);
      }

      tokens.delete(where.id);
      return toTokenResult(existing);
    },
    update: async ({ where, data }: { where: { id: string }; data: { lastUsedAt: Date } }) => {
      const existing = tokens.get(where.id);
      if (!existing) {
        throw new Error(`Token ${where.id} not found`);
      }

      existing.lastUsedAt = new Date(data.lastUsedAt);
      return toTokenResult(existing);
    },
  },
  user: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in
        .map((userId) => users.get(userId))
        .filter((user): user is UserRecord => Boolean(user))
        .map((user) => ({
          id: user.id,
          role: user.role,
          displayName: user.displayName,
        })),
  },
  $transaction: async (callback: (tx: { apiToken: typeof fakePrisma.apiToken }) => Promise<unknown>) =>
    callback({ apiToken: fakePrisma.apiToken }),
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { ApiTokenService } =
  require("../src/services/api-token.service") as typeof import("../src/services/api-token.service");

const service = new ApiTokenService();

beforeEach(() => {
  users.clear();
  tokens.clear();
  tokenSequence = 0;

  users.set("alice", {
    id: "alice",
    role: UserRole.user,
    isActive: true,
    displayName: "Alice Kim",
  });
  users.set("admin", {
    id: "admin",
    role: UserRole.admin,
    isActive: true,
    displayName: "Administrator",
  });
});

test("issueToken creates an ef_ token and stores only the SHA-256 hash", async () => {
  const issued = await service.issueToken("alice", {
    name: "python-package",
  });

  assert.match(issued.token, /^ef_[0-9a-f]{40}$/);
  assert.equal(issued.rotated_previous, false);
  assert.equal(tokens.size, 1);

  const stored = Array.from(tokens.values())[0];
  assert.ok(stored);
  assert.equal(stored.name, "python-package");
  assert.equal(
    stored.tokenHash,
    crypto.createHash("sha256").update(issued.token).digest("hex"),
  );
  assert.notEqual(stored.tokenHash, issued.token);

  const current = await service.getCurrentToken("alice");
  assert.deepEqual(current, {
    id: stored.id,
    name: "python-package",
    last_used_at: null,
    created_at: stored.createdAt.toISOString(),
  });
});

test("issuing a new token rotates the previous token and keeps only one active row", async () => {
  const first = await service.issueToken("alice", {
    name: "notebook",
  });
  const second = await service.issueToken("alice", {
    name: "trainer",
  });

  assert.equal(second.rotated_previous, true);
  assert.equal(tokens.size, 1);

  const stored = Array.from(tokens.values())[0];
  assert.ok(stored);
  assert.equal(stored.name, "trainer");

  assert.equal(await service.verifyStaticToken(first.token), null);
  assert.deepEqual(await service.verifyStaticToken(second.token), {
    userId: "alice",
    role: "user",
  });
});

test("revokeToken enforces ownership while admin listing returns metadata only", async () => {
  const aliceToken = await service.issueToken("alice", {
    name: "jupyter",
  });

  await assert.rejects(
    () => service.revokeToken("someone-else", "user", aliceToken.id),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 403 &&
      error.code === "FORBIDDEN",
  );

  const adminList = await service.listActiveTokensForAdmin();
  assert.deepEqual(adminList, [
    {
      id: aliceToken.id,
      user_id: "alice",
      user_role: "user",
      display_name: "Alice Kim",
      name: "jupyter",
      last_used_at: null,
      created_at: Array.from(tokens.values())[0]?.createdAt.toISOString(),
    },
  ]);

  await service.revokeToken("admin", "admin", aliceToken.id);
  assert.equal(tokens.size, 0);
});

test("verifyStaticToken rejects inactive users and throttles last_used_at updates", async () => {
  const issued = await service.issueToken("alice", {
    name: "worker",
  });
  const stored = Array.from(tokens.values())[0];
  assert.ok(stored);

  stored.lastUsedAt = new Date();
  const firstLastUsedAt = stored.lastUsedAt.toISOString();

  assert.deepEqual(await service.verifyStaticToken(issued.token), {
    userId: "alice",
    role: "user",
  });
  assert.equal(stored.lastUsedAt?.toISOString(), firstLastUsedAt);

  users.set("alice", {
    ...users.get("alice")!,
    isActive: false,
  });

  assert.equal(await service.verifyStaticToken(issued.token), null);
});
