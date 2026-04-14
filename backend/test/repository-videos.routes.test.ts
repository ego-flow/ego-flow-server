import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
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
const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { videoService } =
  require("../src/services/video.service") as typeof import("../src/services/video.service");
const { repositoryVideosRoutes } =
  require("../src/routes/repository-videos.routes") as typeof import("../src/routes/repository-videos.routes");

const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalAssertRepositoryAccess = repositoryService.assertRepositoryAccess;
const originalListRepositoryVideos = videoService.listRepositoryVideos;
const originalGetRepositoryVideoDownload = videoService.getRepositoryVideoDownload;
const originalGetRepositoryVideoThumbnail = videoService.getRepositoryVideoThumbnail;
const originalDeleteRepositoryVideo = videoService.deleteRepositoryVideo;

let server: import("node:http").Server | null = null;
const repoId = "11111111-1111-4111-8111-111111111111";
const videoId = "22222222-2222-4222-8222-222222222222";

const startServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/repositories/:repoId/videos", repositoryVideosRoutes);
  app.use(errorMiddleware);

  server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
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
  videoService.getRepositoryVideoThumbnail = originalGetRepositoryVideoThumbnail;
  videoService.deleteRepositoryVideo = originalDeleteRepositoryVideo;
});

afterEach(async () => {
  (jwtLib as any).verifyAccessToken = originalVerifyAccessToken;
  (jwtLib as any).shouldRefreshToken = originalShouldRefreshToken;
  adminService.getAuthenticatedUser = originalGetAuthenticatedUser;
  repositoryService.assertRepositoryAccess = originalAssertRepositoryAccess;
  videoService.listRepositoryVideos = originalListRepositoryVideos;
  videoService.getRepositoryVideoDownload = originalGetRepositoryVideoDownload;
  videoService.getRepositoryVideoThumbnail = originalGetRepositoryVideoThumbnail;
  videoService.deleteRepositoryVideo = originalDeleteRepositoryVideo;

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

test("repo-scoped list uses repository context resolved by repoAccess", async () => {
  const baseUrl = await startServer();
  let capturedRepositoryId = "";
  let capturedStatus = "";

  videoService.listRepositoryVideos = (async (repository, query) => {
    capturedRepositoryId = repository.id;
    capturedStatus = query.status ?? "";
    return {
      total: 1,
      page: query.page,
      limit: query.limit,
      data: [],
    };
  }) as typeof videoService.listRepositoryVideos;

  const response = await fetch(
    `${baseUrl}/api/v1/repositories/${repoId}/videos?status=COMPLETED&page=2&limit=5`,
    {
      headers: { Authorization: "Bearer jwt-token" },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(capturedRepositoryId, repoId);
  assert.equal(capturedStatus, "COMPLETED");
  assert.deepEqual(await response.json(), {
    total: 1,
    page: 2,
    limit: 5,
    data: [],
  });
});

test("repo-scoped download supports HEAD and Range responses with file metadata headers", async () => {
  const baseUrl = await startServer();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egoflow-video-route-"));
  const videoPath = path.join(tempRoot, `${videoId}.mp4`);

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
      headers: { Authorization: "Bearer jwt-token" },
    });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.headers.get("content-length"), "10");
    assert.equal(headResponse.headers.get("etag"), `"${"a".repeat(64)}"`);
    assert.equal(headResponse.headers.get("x-content-sha256"), "a".repeat(64));
    assert.equal(await headResponse.text(), "");

    const rangeResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/download`, {
      headers: {
        Authorization: "Bearer jwt-token",
        Range: "bytes=2-5",
      },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(rangeResponse.headers.get("content-length"), "4");
    assert.equal(rangeResponse.headers.get("content-disposition"), `attachment; filename="${videoId}.mp4"`);
    assert.equal(await rangeResponse.text(), "2345");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("repo-scoped thumbnail accepts query token and DELETE still requires maintain role", async () => {
  const baseUrl = await startServer();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egoflow-thumbnail-route-"));
  const thumbnailPath = path.join(tempRoot, `${videoId}.jpg`);

  await fs.writeFile(thumbnailPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  videoService.getRepositoryVideoThumbnail = (async () => ({
    id: videoId,
    path: thumbnailPath,
  })) as typeof videoService.getRepositoryVideoThumbnail;
  videoService.deleteRepositoryVideo = (async () => {
    throw new Error("DELETE handler should not execute without maintain access");
  }) as typeof videoService.deleteRepositoryVideo;

  try {
    const thumbnailResponse = await fetch(
      `${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}/thumbnail?token=jwt-token`,
    );
    assert.equal(thumbnailResponse.status, 200);
    assert.equal(thumbnailResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(thumbnailResponse.headers.get("cache-control"), "public, max-age=86400");
    assert.deepEqual(new Uint8Array(await thumbnailResponse.arrayBuffer()), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    const deleteResponse = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/videos/${videoId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer jwt-token" },
    });
    assert.equal(deleteResponse.status, 403);
    assert.equal((await deleteResponse.json()).error.code, "FORBIDDEN");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
