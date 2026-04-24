import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { AppError } from "../src/lib/errors";
import { errorMiddleware } from "../src/middleware/error.middleware";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;
(globalThis as any).__egoflowRedis = new FakeRedis();

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
const fakeRedisModule = { redis: new FakeRedis() };

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
  if (request === "../lib/redis" || request.endsWith("/lib/redis")) {
    return fakeRedisModule;
  }

  if (request === "bullmq") {
    return {
      Queue: class FakeQueue {
        async add() {
          return { id: "fake-job" };
        }

        async getJob() {
          return null;
        }
      },
    };
  }

  return originalLoad(request, parent, isMain);
}) as typeof moduleLoader._load;

const jwtLib = require("../src/lib/jwt") as typeof import("../src/lib/jwt");
const { adminService } =
  require("../src/services/admin.service") as typeof import("../src/services/admin.service");
const { apiTokenService } =
  require("../src/services/api-token.service") as typeof import("../src/services/api-token.service");
const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { videoService } =
  require("../src/services/video.service") as typeof import("../src/services/video.service");
const { repositoriesRoutes } =
  require("../src/routes/repositories.routes") as typeof import("../src/routes/repositories.routes");

const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalVerifyPythonToken = apiTokenService.verifyPythonToken;
const originalAssertRepositoryAccess = repositoryService.assertRepositoryAccess;
const originalResolveRepository = repositoryService.resolveRepository;
const originalGetRepositoryManifest = videoService.getRepositoryManifest;

let server: import("node:http").Server | null = null;
const repoId = "11111111-1111-4111-8111-111111111111";

const startServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/repositories", repositoriesRoutes);
  app.use(errorMiddleware);

  server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

beforeEach(() => {
  (jwtLib as any).verifyAccessToken = originalVerifyAccessToken;
  (jwtLib as any).shouldRefreshToken = originalShouldRefreshToken;
  adminService.getAuthenticatedUser = originalGetAuthenticatedUser;
  apiTokenService.verifyPythonToken = originalVerifyPythonToken;
  repositoryService.assertRepositoryAccess = originalAssertRepositoryAccess;
  repositoryService.resolveRepository = originalResolveRepository;
  videoService.getRepositoryManifest = originalGetRepositoryManifest;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  }
});

test("GET /repositories/resolve supports slug and owner_id/name forms", async () => {
  const baseUrl = await startServer();
  const calls: Array<{ ownerId: string; repoName: string }> = [];

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });
  repositoryService.resolveRepository = (async (
    _requestUserId: string,
    _requestUserRole: "admin" | "user",
    ownerId: string,
    repoName: string,
  ) => {
    calls.push({ ownerId, repoName });
    return {
      repository: {
        id: "repo-1",
        owner_id: ownerId,
        name: repoName,
        visibility: "private",
        description: "Daily kitchen recordings",
        my_role: "read",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-12T00:00:00.000Z",
      },
    };
  }) as typeof repositoryService.resolveRepository;

  const slugResponse = await fetch(
    `${baseUrl}/api/v1/repositories/resolve?slug=alice/daily-kitchen`,
    {
      headers: { Authorization: "Bearer jwt-token" },
    },
  );
  assert.equal(slugResponse.status, 200);

  const explicitResponse = await fetch(
    `${baseUrl}/api/v1/repositories/resolve?owner_id=alice&name=daily-kitchen`,
    {
      headers: { Authorization: "Bearer jwt-token" },
    },
  );
  assert.equal(explicitResponse.status, 200);
  assert.deepEqual(calls, [
    { ownerId: "alice", repoName: "daily-kitchen" },
    { ownerId: "alice", repoName: "daily-kitchen" },
  ]);
});

test("GET /repositories/resolve returns 400 for invalid slug and 404 for hidden repositories", async () => {
  const baseUrl = await startServer();

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  repositoryService.resolveRepository = (async () => {
    throw new AppError(404, "NOT_FOUND", "Repository not found.");
  }) as typeof repositoryService.resolveRepository;

  const invalidSlugResponse = await fetch(
    `${baseUrl}/api/v1/repositories/resolve?slug=alice`,
    {
      headers: { Authorization: "Bearer jwt-token" },
    },
  );
  assert.equal(invalidSlugResponse.status, 400);
  assert.equal((await invalidSlugResponse.json()).error.code, "INVALID_SLUG");

  const hiddenRepoResponse = await fetch(
    `${baseUrl}/api/v1/repositories/resolve?owner_id=alice&name=private-repo`,
    {
      headers: { Authorization: "Bearer jwt-token" },
    },
  );
  assert.equal(hiddenRepoResponse.status, 404);
});

test("GET /repositories/resolve accepts Python static tokens", async () => {
  const baseUrl = await startServer();
  let called = false;

  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  repositoryService.resolveRepository = (async () => {
    called = true;
    return {
      repository: {
        id: "repo-1",
        owner_id: "alice",
        name: "daily-kitchen",
        visibility: "private",
        description: "Daily kitchen recordings",
        my_role: "read",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-12T00:00:00.000Z",
      },
    };
  }) as typeof repositoryService.resolveRepository;

  const response = await fetch(`${baseUrl}/api/v1/repositories/resolve?slug=alice/daily-kitchen`, {
    headers: { Authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567" },
  });

  assert.equal(response.status, 200);
  assert.equal(called, true);
});

test("GET /repositories/:repoId/manifest uses repoAccess context and validated query params", async () => {
  const baseUrl = await startServer();
  let capturedRepoId = "";
  let capturedRole = "";
  let capturedPage = 0;
  let capturedLimit = 0;

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });
  repositoryService.assertRepositoryAccess = (async () => ({
    repository: {
      id: repoId,
      name: "daily-kitchen",
      ownerId: "alice",
      visibility: "private",
      description: "Daily kitchen recordings",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    effectiveRole: "read",
    isSystemAdmin: false,
  })) as typeof repositoryService.assertRepositoryAccess;
  videoService.getRepositoryManifest = (async (requestedRepoId, repository, effectiveRole, query) => {
    capturedRepoId = requestedRepoId;
    capturedRole = effectiveRole;
    capturedPage = query.page;
    capturedLimit = query.limit;

    return {
      manifest_version: "1",
      repository: {
        id: repository.id,
        owner_id: repository.ownerId,
        name: repository.name,
        visibility: repository.visibility,
        my_role: effectiveRole,
      },
      default_artifact: "vlm_video",
      pagination: {
        total: 0,
        page: query.page,
        limit: query.limit,
        has_next: false,
      },
      videos: [],
    };
  }) as typeof videoService.getRepositoryManifest;

  const response = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/manifest?page=2&limit=5`, {
    headers: { Authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567" },
  });

  assert.equal(response.status, 200);
  assert.equal(capturedRepoId, repoId);
  assert.equal(capturedRole, "read");
  assert.equal(capturedPage, 2);
  assert.equal(capturedLimit, 5);
  assert.deepEqual(await response.json(), {
    manifest_version: "1",
    repository: {
      id: repoId,
      owner_id: "alice",
      name: "daily-kitchen",
      visibility: "private",
      my_role: "read",
    },
    default_artifact: "vlm_video",
    pagination: {
      total: 0,
      page: 2,
      limit: 5,
      has_next: false,
    },
    videos: [],
  });
});

test("GET /repositories/:repoId/manifest rejects invalid queries and missing auth", async () => {
  const baseUrl = await startServer();

  const unauthorizedResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/manifest`);
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal((await unauthorizedResponse.json()).error.code, "UNAUTHORIZED");

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });
  repositoryService.assertRepositoryAccess = (async () => ({
    repository: {
      id: repoId,
      name: "daily-kitchen",
      ownerId: "alice",
      visibility: "public",
      description: "Daily kitchen recordings",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    effectiveRole: "read",
    isSystemAdmin: false,
  })) as typeof repositoryService.assertRepositoryAccess;

  const invalidLimitResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/manifest?limit=201`, {
    headers: { Authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567" },
  });
  assert.equal(invalidLimitResponse.status, 400);
  assert.equal((await invalidLimitResponse.json()).error.code, "VALIDATION_ERROR");
});

test("GET /repositories/:repoId/manifest applies default page and limit", async () => {
  const baseUrl = await startServer();
  let capturedPage = 0;
  let capturedLimit = 0;

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });
  repositoryService.assertRepositoryAccess = (async () => ({
    repository: {
      id: repoId,
      name: "daily-kitchen",
      ownerId: "alice",
      visibility: "private",
      description: "Daily kitchen recordings",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    effectiveRole: "read",
    isSystemAdmin: false,
  })) as typeof repositoryService.assertRepositoryAccess;
  videoService.getRepositoryManifest = (async (_repoId, repository, effectiveRole, query) => {
    capturedPage = query.page;
    capturedLimit = query.limit;

    return {
      manifest_version: "1",
      repository: {
        id: repository.id,
        owner_id: repository.ownerId,
        name: repository.name,
        visibility: repository.visibility,
        my_role: effectiveRole,
      },
      default_artifact: "vlm_video",
      pagination: {
        total: 0,
        page: query.page,
        limit: query.limit,
        has_next: false,
      },
      videos: [],
    };
  }) as typeof videoService.getRepositoryManifest;

  const response = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/manifest`, {
    headers: { Authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567" },
  });

  assert.equal(response.status, 200);
  assert.equal(capturedPage, 1);
  assert.equal(capturedLimit, 50);
});
