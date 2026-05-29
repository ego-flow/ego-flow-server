import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
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
const { dashboardSessionService } =
  require("../src/services/dashboard-session.service") as typeof import("../src/services/dashboard-session.service");
const { verifySignedFileUrlToken } =
  require("../src/lib/signed-file-url") as typeof import("../src/lib/signed-file-url");
const { getTargetDirectory } =
  require("../src/lib/storage") as typeof import("../src/lib/storage");
const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { videoService } =
  require("../src/services/video.service") as typeof import("../src/services/video.service");
const { repositoryVideosRoutes } =
  require("../src/routes/repository-videos.routes") as typeof import("../src/routes/repository-videos.routes");

const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalVerifyPythonToken = apiTokenService.verifyPythonToken;
const originalVerifyDashboardSession = dashboardSessionService.verifySession;
const originalAssertRepositoryAccess = repositoryService.assertRepositoryAccess;
const originalListRepositoryVideos = videoService.listRepositoryVideos;
const originalGetRepositoryVideoDownload = videoService.getRepositoryVideoDownload;
const originalDeleteRepositoryVideo = videoService.deleteRepositoryVideo;

const repoId = "11111111-1111-4111-8111-111111111111";
const videoId = "22222222-2222-4222-8222-222222222222";
const targetDirectory = getTargetDirectory();

const startServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/repositories/:repoId/videos", repositoryVideosRoutes);
  app.use(errorMiddleware);

  const listening = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    listening.once("listening", () => resolve());
    listening.once("error", reject);
  });

  const { port } = listening.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        listening.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

beforeEach(() => {
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
  apiTokenService.verifyPythonToken = async (token: string) =>
    token === "ef_python-token"
      ? {
          userId: "alice",
          role: "user",
        }
      : null;
  dashboardSessionService.verifySession = async (token: string) =>
    token === "dashboard-session"
      ? {
          sessionId: "session-1",
          userId: "alice",
          role: "user",
          displayName: "Alice Kim",
        }
      : null;
  repositoryService.assertRepositoryAccess = (async (
    _userId: string,
    _userRole: "admin" | "user",
    repoId: string,
    minRole: "read" | "maintain" | "admin",
  ) => {
    if (minRole === "maintain") {
      throw new AppError(403, "FORBIDDEN", "Insufficient repository permissions.");
    }

    return {
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
    };
  }) as typeof repositoryService.assertRepositoryAccess;
  videoService.listRepositoryVideos = originalListRepositoryVideos;
  videoService.getRepositoryVideoDownload = originalGetRepositoryVideoDownload;
  videoService.deleteRepositoryVideo = originalDeleteRepositoryVideo;
});

afterEach(async () => {
  (jwtLib as any).verifyAccessToken = originalVerifyAccessToken;
  (jwtLib as any).shouldRefreshToken = originalShouldRefreshToken;
  adminService.getAuthenticatedUser = originalGetAuthenticatedUser;
  apiTokenService.verifyPythonToken = originalVerifyPythonToken;
  dashboardSessionService.verifySession = originalVerifyDashboardSession;
  repositoryService.assertRepositoryAccess = originalAssertRepositoryAccess;
  videoService.listRepositoryVideos = originalListRepositoryVideos;
  videoService.getRepositoryVideoDownload = originalGetRepositoryVideoDownload;
  videoService.deleteRepositoryVideo = originalDeleteRepositoryVideo;

});

test("repo-scoped list uses repository context resolved by repoAccess", { concurrency: false }, async () => {
  const { baseUrl, close } = await startServer();
  let capturedRepositoryId = "";
  let capturedStatus = "";

  videoService.listRepositoryVideos = (async (repository, query) => {
    capturedRepositoryId = repository.id;
    capturedStatus = query.status ?? "";
    return {
      total: 1,
      page: query.page,
      limit: query.limit,
      contributors: [],
      data: [],
    };
  }) as typeof videoService.listRepositoryVideos;

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/repositories/${repoId}/videos?status=COMPLETED&page=2&limit=5`,
      {
        headers: { Cookie: "egoflow_session=dashboard-session" },
      },
    );

    assert.equal(response.status, 200);
    assert.equal(capturedRepositoryId, repoId);
    assert.equal(capturedStatus, "COMPLETED");
    assert.deepEqual(await response.json(), {
      total: 1,
      page: 2,
      limit: 5,
      contributors: [],
      data: [],
    });
  } finally {
    await close();
  }
});

test("repo-scoped download accepts dashboard sessions and Python bearer tokens, then redirects to a signed file URL", { concurrency: false }, async () => {
  const { baseUrl, close } = await startServer();
  const videoPath = path.join(targetDirectory, "alice", "daily-kitchen", ".codex-test", `${videoId}.mp4`);

  await fs.mkdir(path.dirname(videoPath), { recursive: true });
  await fs.writeFile(videoPath, Buffer.from("0123456789", "utf8"));

  videoService.getRepositoryVideoDownload = (async () => ({
    id: videoId,
    path: videoPath,
    sizeBytes: 10n,
    sha256: "a".repeat(64),
  })) as typeof videoService.getRepositoryVideoDownload;

  try {
    const headResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/download`, {
      method: "HEAD",
      headers: { Cookie: "egoflow_session=dashboard-session" },
      redirect: "manual",
    });
    assert.equal(headResponse.status, 307);
    const headLocation = headResponse.headers.get("location");
    assert.ok(headLocation);
    assert.equal(await headResponse.text(), "");

    const downloadResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/download`, {
      headers: {
        Cookie: "egoflow_session=dashboard-session",
      },
      redirect: "manual",
    });
    assert.equal(downloadResponse.status, 307);
    const downloadLocation = downloadResponse.headers.get("location");
    assert.ok(downloadLocation);

    const redirectedUrl = new URL(downloadLocation, baseUrl);
    assert.equal(redirectedUrl.pathname, `/files/alice/daily-kitchen/.codex-test/${videoId}.mp4`);
    const signature = redirectedUrl.searchParams.get("signature");
    assert.ok(signature);
    assert.equal(verifySignedFileUrlToken(signature).path, `alice/daily-kitchen/.codex-test/${videoId}.mp4`);

    const queryTokenResponse = await fetch(
      `${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/download?token=jwt-token`,
      {
        redirect: "manual",
      },
    );
    assert.equal(queryTokenResponse.status, 401);
    assert.equal((await queryTokenResponse.json()).error.code, "UNAUTHORIZED");

    const pythonTokenResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/download`, {
      headers: {
        Authorization: "Bearer ef_python-token",
      },
      redirect: "manual",
    });
    assert.equal(pythonTokenResponse.status, 307);
    const pythonTokenLocation = pythonTokenResponse.headers.get("location");
    assert.ok(pythonTokenLocation);
    const pythonTokenRedirect = new URL(pythonTokenLocation, baseUrl);
    const pythonTokenSignature = pythonTokenRedirect.searchParams.get("signature");
    assert.ok(pythonTokenSignature);
    assert.equal(
      verifySignedFileUrlToken(pythonTokenSignature).path,
      `alice/daily-kitchen/.codex-test/${videoId}.mp4`,
    );
  } finally {
    await close();
    await fs.rm(videoPath, { force: true });
    await fs.rm(path.dirname(videoPath), { recursive: true, force: true });
  }
});

test("repo-scoped DELETE requires maintain role", { concurrency: false }, async () => {
  const { baseUrl, close } = await startServer();
  videoService.deleteRepositoryVideo = (async () => {
    throw new Error("DELETE handler should not execute without maintain access");
  }) as typeof videoService.deleteRepositoryVideo;

  try {
    const deleteResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}`, {
      method: "DELETE",
      headers: { Cookie: "egoflow_session=dashboard-session" },
    });
    assert.equal(deleteResponse.status, 403);
    assert.equal((await deleteResponse.json()).error.code, "FORBIDDEN");
  } finally {
    await close();
  }
});
