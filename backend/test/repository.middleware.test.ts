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
const { repoAccess, repoStatus } =
  require("../src/middleware/repository.middleware") as typeof import("../src/middleware/repository.middleware");

const originalAssertAction = repositoryAccessService.assertAction;
const originalAssertRepositoryStatus = repositoryAccessService.assertRepositoryStatus;

const createResponse = () => ({});

beforeEach(() => {
  repositoryAccessService.assertAction = originalAssertAction;
  repositoryAccessService.assertRepositoryStatus = originalAssertRepositoryStatus;
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
  repositoryAccessService.assertAction = (async (...args) => {
    capturedArgs = args;
    return access;
  }) as typeof repositoryAccessService.assertAction;

  const req: any = {
    params: { repoId: "repo-1" },
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = "not-called";

  await repoAccess({ action: "repository.updateSettings" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(capturedArgs, ["alice", "user", "repo-1", "repository.updateSettings"]);
  assert.equal(req.repositoryAccess, access);
});

test("repoAccess can resolve repository id from request body", async () => {
  const access: RepositoryAccessContext = {
    repository: {
      id: "repo-body",
      name: "daily-kitchen",
      ownerId: "alice",
      visibility: "private",
      description: null,
      tags: [],
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    effectiveRole: "maintain",
    isSystemAdmin: false,
  };
  let capturedArgs: unknown[] = [];
  repositoryAccessService.assertAction = (async (...args) => {
    capturedArgs = args;
    return access;
  }) as typeof repositoryAccessService.assertAction;
  const req: any = {
    body: { repositoryId: " repo-body " },
    params: {},
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = "not-called";

  await repoAccess({
    action: "stream.record",
    repositoryId: (request) => request.body.repositoryId,
  })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(capturedArgs, ["alice", "user", "repo-body", "stream.record"]);
  assert.equal(req.repositoryAccess, access);
});

test("repoAccess rejects unauthenticated requests", async () => {
  const req: any = {
    params: { repoId: "repo-1" },
  };
  let nextError: unknown = null;

  await repoAccess({ action: "video.download" })(req, createResponse() as any, (error?: unknown) => {
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

  await repoAccess({ action: "video.download" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 400);
  assert.equal(nextError.message, "Repository id is required.");
});

test("repoAccess passes repository access errors through", async () => {
  const expectedError = new Error("access failure");
  repositoryAccessService.assertAction = (async () => {
    throw expectedError;
  }) as typeof repositoryAccessService.assertAction;
  const req: any = {
    params: { repoId: "repo-1" },
    user: {
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    },
  };
  let nextError: unknown = null;

  await repoAccess({ action: "video.download" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, expectedError);
});

test("repoStatus checks params.repoId with the required status", async () => {
  let capturedArgs: unknown[] = [];
  repositoryAccessService.assertRepositoryStatus = (async (...args) => {
    capturedArgs = args;
    return { id: String(args[0]), deactivated: false };
  }) as typeof repositoryAccessService.assertRepositoryStatus;
  const req: any = {
    params: { repoId: "repo-1" },
  };
  let nextError: unknown = "not-called";

  await repoStatus({ required: "active" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(capturedArgs, ["repo-1", "active"]);
});

test("repoStatus can resolve repository id from request body", async () => {
  let capturedArgs: unknown[] = [];
  repositoryAccessService.assertRepositoryStatus = (async (...args) => {
    capturedArgs = args;
    return { id: String(args[0]), deactivated: false };
  }) as typeof repositoryAccessService.assertRepositoryStatus;
  const req: any = {
    body: { repositoryId: " repo-body " },
    params: {},
  };
  let nextError: unknown = "not-called";

  await repoStatus({
    required: "active",
    repositoryId: (request) => request.body.repositoryId,
  })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(capturedArgs, ["repo-body", "active"]);
});

test("repoStatus requires params.repoId", async () => {
  const req: any = {
    params: {},
  };
  let nextError: unknown = null;

  await repoStatus({ required: "deactivated" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 400);
  assert.equal(nextError.message, "Repository id is required.");
});

test("repoStatus passes repository status errors through", async () => {
  const expectedError = new Error("status failure");
  repositoryAccessService.assertRepositoryStatus = (async () => {
    throw expectedError;
  }) as typeof repositoryAccessService.assertRepositoryStatus;
  const req: any = {
    params: { repoId: "repo-1" },
  };
  let nextError: unknown = null;

  await repoStatus({ required: "active" })(req, createResponse() as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, expectedError);
});
