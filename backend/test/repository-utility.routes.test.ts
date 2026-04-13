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
const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { repositoriesRoutes } =
  require("../src/routes/repositories.routes") as typeof import("../src/routes/repositories.routes");

const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalResolveRepository = repositoryService.resolveRepository;

let server: import("node:http").Server | null = null;

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
  repositoryService.resolveRepository = originalResolveRepository;
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
