import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { RepositoryAccessContext } from "../src/types/repository";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;

const { AppError } = require("../src/lib/errors") as typeof import("../src/lib/errors");
const { repositoryAccessService } =
  require("../src/services/repository-access.service") as typeof import("../src/services/repository-access.service");
const { repoAccess } =
  require("../src/middleware/repo-access.middleware") as typeof import("../src/middleware/repo-access.middleware");

const originalAssertAccess = repositoryAccessService.assertAccess;

const createResponse = () => ({});

beforeEach(() => {
  repositoryAccessService.assertAccess = originalAssertAccess;
});

test("repoAccess stores repository access resolved from params.repoId", async () => {
  const access: RepositoryAccessContext = {
    repository: {
      id: "repo-1",
      name: "daily-kitchen",
      ownerId: "alice",
      visibility: "private",
      description: null,
      tags: [],
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    effectiveRole: "admin",
    isSystemAdmin: false,
  };
  let capturedArgs: unknown[] = [];
  repositoryAccessService.assertAccess = (async (...args) => {
    capturedArgs = args;
    return access;
  }) as typeof repositoryAccessService.assertAccess;

  const req: any = {
    params: { repoId: "repo-1" },
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = "not-called";

  await repoAccess({ minRole: "admin" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(capturedArgs, ["alice", "user", "repo-1", "admin"]);
  assert.equal(req.repositoryAccess, access);
});

test("repoAccess rejects unauthenticated requests", async () => {
  const req: any = {
    params: { repoId: "repo-1" },
  };
  let nextError: unknown = null;

  await repoAccess({ minRole: "read" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 401);
});

test("repoAccess requires params.repoId", async () => {
  const req: any = {
    params: {},
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = null;

  await repoAccess({ minRole: "read" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 400);
  assert.equal(nextError.message, "Repository id is required.");
});

test("repoAccess passes repository access errors through", async () => {
  const expectedError = new Error("access failure");
  repositoryAccessService.assertAccess = (async () => {
    throw expectedError;
  }) as typeof repositoryAccessService.assertAccess;
  const req: any = {
    params: { repoId: "repo-1" },
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = null;

  await repoAccess({ minRole: "read" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, expectedError);
});
