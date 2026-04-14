import assert from "node:assert/strict";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { VideoStatus } from "@prisma/client";

import { AppError } from "../src/lib/errors";
import type { RepositoryRecord } from "../src/types/repository";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
  if (request === "../lib/redis" || request.endsWith("/lib/redis")) {
    return {
      redis: {
        get: async () => null,
        set: async () => "OK",
        del: async () => 0,
      },
    };
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

type VideoRow = {
  id: string;
  repositoryId: string;
  status: VideoStatus;
  durationSec: number | null;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  fps: number | null;
  codec: string | null;
  recordedAt: Date | null;
  thumbnailPath: string | null;
  dashboardVideoPath: string | null;
  vlmVideoPath: string | null;
  vlmSizeBytes: bigint | null;
  vlmSha256: string | null;
  sceneSummary: string | null;
  clipSegments: unknown;
  createdAt: Date;
  recordingSessionId: string | null;
  errorMessage: string | null;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
};

const videos = new Map<string, VideoRow>();

const pickFields = (video: VideoRow, select?: Record<string, boolean>) => {
  if (!select) {
    return { ...video };
  }

  const result: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      result[key] = (video as Record<string, unknown>)[key];
    }
  }

  return result;
};

const fakePrisma: any = {
  video: {
    count: async ({ where }: { where: { repositoryId: string; status?: VideoStatus } }) =>
      Array.from(videos.values()).filter(
        (video) => video.repositoryId === where.repositoryId && (!where.status || video.status === where.status),
      ).length,
    findMany: async ({
      where,
      skip,
      take,
      orderBy,
      select,
    }: {
      where: { repositoryId: string; status?: VideoStatus };
      skip: number;
      take: number;
      orderBy: { createdAt?: "asc" | "desc"; recordedAt?: "asc" | "desc"; durationSec?: "asc" | "desc" };
      select: Record<string, boolean>;
    }) => {
      const sortField = orderBy.createdAt ? "createdAt" : orderBy.recordedAt ? "recordedAt" : "durationSec";
      const sortDirection = orderBy.createdAt ?? orderBy.recordedAt ?? orderBy.durationSec ?? "desc";
      const filtered = Array.from(videos.values()).filter(
        (video) => video.repositoryId === where.repositoryId && (!where.status || video.status === where.status),
      );
      filtered.sort((left, right) => {
        const leftValue =
          sortField === "createdAt"
            ? left.createdAt
            : sortField === "recordedAt"
              ? left.recordedAt
              : left.durationSec;
        const rightValue =
          sortField === "createdAt"
            ? right.createdAt
            : sortField === "recordedAt"
              ? right.recordedAt
              : right.durationSec;
        const leftSort = leftValue instanceof Date ? leftValue.getTime() : leftValue ?? -1;
        const rightSort = rightValue instanceof Date ? rightValue.getTime() : rightValue ?? -1;
        return sortDirection === "asc" ? leftSort - rightSort : rightSort - leftSort;
      });
      return filtered.slice(skip, skip + take).map((video) => pickFields(video, select));
    },
    findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
      const video = videos.get(where.id);
      return video ? pickFields(video, select) : null;
    },
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { VideoService } = require("../src/services/video.service") as typeof import("../src/services/video.service");
const { verifySignedFileUrlToken } =
  require("../src/lib/signed-file-url") as typeof import("../src/lib/signed-file-url");
const { getTargetDirectory } = require("../src/lib/storage") as typeof import("../src/lib/storage");

const service = new VideoService();
const targetDirectory = getTargetDirectory();

const repository: RepositoryRecord = {
  id: "repo-1",
  name: "daily-kitchen",
  ownerId: "alice",
  visibility: "private",
  description: "Daily kitchen recordings",
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  updatedAt: new Date("2026-04-12T00:00:00.000Z"),
};

beforeEach(() => {
  videos.clear();

  videos.set("video-1", {
    id: "video-1",
    repositoryId: "repo-1",
    status: VideoStatus.COMPLETED,
    durationSec: 14.2,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    fps: 30,
    codec: "h264",
    recordedAt: new Date("2026-04-12T01:02:03.000Z"),
    thumbnailPath: path.join(targetDirectory, "alice", "daily-kitchen", ".thumbnails", "video-1.jpg"),
    dashboardVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", ".dashboard", "video-1.mp4"),
    vlmVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", "video-1.mp4"),
    vlmSizeBytes: 42n,
    vlmSha256: "a".repeat(64),
    sceneSummary: null,
    clipSegments: null,
    createdAt: new Date("2026-04-12T01:05:00.000Z"),
    recordingSessionId: "session-1",
    errorMessage: null,
    processingStartedAt: new Date("2026-04-12T01:03:00.000Z"),
    processingCompletedAt: new Date("2026-04-12T01:04:00.000Z"),
  });

  videos.set("video-2", {
    id: "video-2",
    repositoryId: "repo-2",
    status: VideoStatus.PROCESSING,
    durationSec: null,
    resolutionWidth: null,
    resolutionHeight: null,
    fps: null,
    codec: null,
    recordedAt: null,
    thumbnailPath: null,
    dashboardVideoPath: null,
    vlmVideoPath: null,
    vlmSizeBytes: null,
    vlmSha256: null,
    sceneSummary: null,
    clipSegments: null,
    createdAt: new Date("2026-04-13T00:00:00.000Z"),
    recordingSessionId: "session-2",
    errorMessage: null,
    processingStartedAt: null,
    processingCompletedAt: null,
  });
});

test("listRepositoryVideos returns repo-scoped responses without internal file paths", async () => {
  const response = await service.listRepositoryVideos(repository, {
    page: 1,
    limit: 20,
    sort_by: "created_at",
    sort_order: "desc",
  });

  assert.equal(response.total, 1);
  assert.equal(response.data.length, 1);
  assert.deepEqual(response.data[0], {
    id: "video-1",
    repository_id: "repo-1",
    repository_name: "daily-kitchen",
    owner_id: "alice",
    status: "COMPLETED",
    duration_sec: 14.2,
    resolution_width: 1280,
    resolution_height: 720,
    fps: 30,
    codec: "h264",
    recorded_at: "2026-04-12T01:02:03.000Z",
    thumbnail_url: "/api/v1/repositories/repo-1/videos/video-1/thumbnail",
    scene_summary: null,
    clip_segments: null,
    created_at: "2026-04-12T01:05:00.000Z",
  });
  assert.equal("dashboard_video_url" in response.data[0], false);
  assert.equal("vlm_video_path" in response.data[0], false);
});

test("repo-scoped detail returns a signed dashboard playback URL", async () => {
  const response = await service.getRepositoryVideoDetail("repo-1", repository, "video-1");

  assert.equal(response.id, "video-1");
  assert.equal(typeof response.dashboard_video_url, "string");

  const playbackUrl = new URL(response.dashboard_video_url as string, "http://backend.local");
  assert.equal(playbackUrl.pathname, "/files/alice/daily-kitchen/.dashboard/video-1.mp4");
  assert.equal(playbackUrl.searchParams.has("token"), false);

  const signature = playbackUrl.searchParams.get("signature");
  assert.ok(signature);
  assert.equal(verifySignedFileUrlToken(signature).path, "alice/daily-kitchen/.dashboard/video-1.mp4");
});

test("repo-scoped detail returns 404 when the video belongs to another repository", async () => {
  await assert.rejects(
    () => service.getRepositoryVideoDetail("repo-1", repository, "video-2"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND",
  );
});

test("repo-scoped download and thumbnail require available completed artifacts", async () => {
  await assert.rejects(
    () => service.getRepositoryVideoDownload("repo-2", "video-2"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND",
  );

  await assert.rejects(
    () => service.getRepositoryVideoThumbnail("repo-2", "video-2"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND",
  );
});
