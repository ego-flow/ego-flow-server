import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;

const { AppError } = require("../src/lib/errors") as typeof import("../src/lib/errors");
const { repoStatus } =
  require("../src/middleware/repo-status.middleware") as typeof import("../src/middleware/repo-status.middleware");
const { repositoryAccessService } =
  require("../src/services/repository-access.service") as typeof import("../src/services/repository-access.service");

const originalAssertRepositoryStatus = repositoryAccessService.assertRepositoryStatus;

const createResponse = () => ({});

beforeEach(() => {
  repositoryAccessService.assertRepositoryStatus = originalAssertRepositoryStatus;
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
