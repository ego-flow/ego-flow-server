import assert from "node:assert/strict";
import path from "node:path";
import { beforeEach, test } from "node:test";
import { VideoStatus } from "@prisma/client";

import { AppError } from "../src/lib/core/errors";
import type { RepositoryAccessContext, RepositoryRecord } from "../src/types/repository";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
const fakeBullJobProgress = new Map<string, unknown>();

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
  if (request === "../lib/infra/redis" || request.endsWith("/lib/infra/redis")) {
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
          return { progress: fakeBullJobProgress.get("finalize-session-processing") ?? null };
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
  sizeBytes: bigint | null;
  vlmSha256: string | null;
  recorder: string | null;
  semanticMetadata: {
    sceneSummary: string | null;
    clipSegments: unknown;
  } | null;
  createdAt: Date;
  recordingSessionId: string | null;
  errorMessage: string | null;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
};

const videos = new Map<string, VideoRow>();
const users = new Map<string, { id: string; displayName: string }>();

const pickFields = (video: VideoRow, select?: Record<string, unknown>) => {
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

const matchesWhere = (
  video: VideoRow,
  where: {
    repositoryId: string;
    status?: VideoStatus;
    recorder?: string | { in: string[] };
  },
) =>
  video.repositoryId === where.repositoryId &&
  (!where.status || video.status === where.status) &&
  (!where.recorder ||
    (typeof where.recorder === "string"
      ? video.recorder === where.recorder
      : Boolean(video.recorder && where.recorder.in.includes(video.recorder))));

const fakePrisma: any = {
  videos: {
    count: async ({ where }: { where: Parameters<typeof matchesWhere>[1] }) =>
      Array.from(videos.values()).filter((video) => matchesWhere(video, where)).length,
    findMany: async ({
      where,
      skip,
      take,
      orderBy,
      select,
    }: {
      where: Parameters<typeof matchesWhere>[1];
      skip?: number;
      take?: number;
      orderBy?: {
        createdAt?: "asc" | "desc";
        recordedAt?: "asc" | "desc";
        durationSec?: "asc" | "desc";
        sizeBytes?: "asc" | "desc";
      };
      select: Record<string, unknown>;
    }) => {
      const sortField = orderBy?.createdAt
        ? "createdAt"
        : orderBy?.recordedAt
          ? "recordedAt"
          : orderBy?.durationSec
            ? "durationSec"
            : orderBy?.sizeBytes
              ? "sizeBytes"
              : "createdAt";
      const sortDirection =
        orderBy?.createdAt ??
        orderBy?.recordedAt ??
        orderBy?.durationSec ??
        orderBy?.sizeBytes ??
        "desc";
      const filtered = Array.from(videos.values()).filter((video) => matchesWhere(video, where));
      filtered.sort((left, right) => {
        const leftValue =
          sortField === "createdAt"
            ? left.createdAt
            : sortField === "recordedAt"
              ? left.recordedAt
              : sortField === "durationSec"
                ? left.durationSec
                : sortField === "sizeBytes"
                  ? left.sizeBytes
                  : left.createdAt;
        const rightValue =
          sortField === "createdAt"
            ? right.createdAt
            : sortField === "recordedAt"
              ? right.recordedAt
              : sortField === "durationSec"
                ? right.durationSec
                : sortField === "sizeBytes"
                  ? right.sizeBytes
                  : right.createdAt;
        const leftSort = leftValue instanceof Date ? leftValue.getTime() : Number(leftValue ?? -1);
        const rightSort = rightValue instanceof Date ? rightValue.getTime() : Number(rightValue ?? -1);
        return sortDirection === "asc" ? leftSort - rightSort : rightSort - leftSort;
      });
      const offset = skip ?? 0;
      const limit = take ?? filtered.length;
      return filtered.slice(offset, offset + limit).map((video) => pickFields(video, select));
    },
    findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
      const video = videos.get(where.id);
      return video ? pickFields(video, select) : null;
    },
  },
  users: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => users.get(id)).filter(Boolean),
  },
  repositories: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === "repo-1"
        ? {
            contributors: ["alice", "bob"],
          }
        : {
            contributors: ["alice"],
          },
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { VideosService } = require("../src/services/videos.service") as typeof import("../src/services/videos.service");
const { repositoriesService } =
  require("../src/services/repositories.service") as typeof import("../src/services/repositories.service");
const { verifySignedFileUrlToken } =
  require("../src/lib/storage/signed-file-url") as typeof import("../src/lib/storage/signed-file-url");
const { getTargetDirectory } = require("../src/lib/storage/storage") as typeof import("../src/lib/storage/storage");

const service = new VideosService();
const targetDirectory = getTargetDirectory();

const assertSignedFileUrl = (value: string | null | undefined, expectedPath: string) => {
  assert.equal(typeof value, "string");
  const url = new URL(value as string, "http://backend.local");
  assert.equal(url.pathname, `/files/${expectedPath.split("/").map(encodeURIComponent).join("/")}`);
  const signature = url.searchParams.get("signature");
  assert.ok(signature);
  assert.equal(verifySignedFileUrlToken(signature).path, expectedPath);
};

const repository: RepositoryRecord = {
  id: "repo-1",
  name: "daily-kitchen",
  ownerId: "alice",
  visibility: "private",
  description: "Daily kitchen recordings",
  tags: ["kitchen"],
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  updatedAt: new Date("2026-04-12T00:00:00.000Z"),
};

const repositoryAccess = (
  record: RepositoryRecord,
  effectiveRole: RepositoryAccessContext["effectiveRole"] = "read",
): RepositoryAccessContext => ({
  repository: record,
  effectiveRole,
  isSystemAdmin: false,
});

beforeEach(() => {
  videos.clear();
  users.clear();
  fakeBullJobProgress.clear();
  users.set("alice", { id: "alice", displayName: "Alice Kim" });
  users.set("bob", { id: "bob", displayName: "Bob Lee" });

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
    sizeBytes: 42n,
    vlmSha256: "a".repeat(64),
    recorder: "alice",
    semanticMetadata: null,
    createdAt: new Date("2026-04-12T01:05:00.000Z"),
    recordingSessionId: "session-1",
    errorMessage: null,
    processingStartedAt: new Date("2026-04-12T01:03:00.000Z"),
    processingCompletedAt: new Date("2026-04-12T01:04:00.000Z"),
  });

  videos.set("video-2", {
    id: "video-2",
    repositoryId: "repo-2",
    status: VideoStatus.FAILED,
    durationSec: null,
    resolutionWidth: null,
    resolutionHeight: null,
    fps: null,
    codec: null,
    recordedAt: null,
    thumbnailPath: null,
    dashboardVideoPath: null,
    vlmVideoPath: null,
    sizeBytes: null,
    vlmSha256: null,
    recorder: "alice",
    semanticMetadata: null,
    createdAt: new Date("2026-04-13T00:00:00.000Z"),
    recordingSessionId: "session-2",
    errorMessage: null,
    processingStartedAt: null,
    processingCompletedAt: null,
  });

  videos.set("video-3", {
    id: "video-3",
    repositoryId: "repo-1",
    status: VideoStatus.COMPLETED,
    durationSec: 9.5,
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    fps: 60,
    codec: "h265",
    recordedAt: new Date("2026-04-11T09:30:00.000Z"),
    thumbnailPath: null,
    dashboardVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", ".dashboard", "video-3.mp4"),
    vlmVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", "video-3.mp4"),
    sizeBytes: 84n,
    vlmSha256: "b".repeat(64),
    recorder: "bob",
    semanticMetadata: {
      sceneSummary: "Kitchen prep",
      clipSegments: [{ start_sec: 0, end_sec: 9.5 }],
    },
    createdAt: new Date("2026-04-11T09:35:00.000Z"),
    recordingSessionId: "session-3",
    errorMessage: null,
    processingStartedAt: new Date("2026-04-11T09:31:00.000Z"),
    processingCompletedAt: new Date("2026-04-11T09:34:00.000Z"),
  });
});

test("listRepositoryVideos returns repo-scoped responses without internal file paths", async () => {
  const response = await service.listRepositoryVideos(repository, {
    page: 1,
    limit: 20,
    sort_by: "recorded_at",
    sort_order: "desc",
  });

  assert.equal(response.total, 2);
  assert.deepEqual(response.contributors, [
    {
      user_id: "alice",
      display_name: "Alice Kim",
      video_count: 1,
      latest_recorded_at: "2026-04-12T01:02:03.000Z",
    },
    {
      user_id: "bob",
      display_name: "Bob Lee",
      video_count: 1,
      latest_recorded_at: "2026-04-11T09:30:00.000Z",
    },
  ]);
  assert.equal(response.data.length, 2);
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
    size_bytes: 42,
    contributor_user_id: "alice",
    contributor_display_name: "Alice Kim",
    thumbnail_url: response.data[0]!.thumbnail_url,
    processing_progress: null,
    scene_summary: null,
    clip_segments: null,
    created_at: "2026-04-12T01:05:00.000Z",
  });
  assertSignedFileUrl(response.data[0]!.thumbnail_url, "alice/daily-kitchen/.thumbnails/video-1.jpg");
  assert.equal("dashboard_video_url" in response.data[0], false);
  assert.equal("vlm_video_path" in response.data[0], false);
});

test("listRepositoryVideos filters by contributor and sorts by file size", async () => {
  const response = await service.listRepositoryVideos(repository, {
    page: 1,
    limit: 20,
    contributor_user_id: "bob",
    sort_by: "size_bytes",
    sort_order: "desc",
  });

  assert.equal(response.total, 1);
  assert.equal(response.data[0]!.id, "video-3");
  assert.equal(response.data[0]!.size_bytes, 84);
  assert.equal(response.data[0]!.contributor_user_id, "bob");
  assert.equal(response.data[0]!.contributor_display_name, "Bob Lee");
});

test("repo-scoped detail returns a signed dashboard playback URL", async () => {
  const response = await service.getRepositoryVideoDetail("repo-1", repository, "video-1");

  assert.equal(response.id, "video-1");
  assert.equal(typeof response.dashboard_video_url, "string");
  assert.equal(response.size_bytes, 42);
  assert.equal(response.contributor_user_id, "alice");
  assert.equal(response.contributor_display_name, "Alice Kim");

  assertSignedFileUrl(response.dashboard_video_url, "alice/daily-kitchen/.dashboard/video-1.mp4");
});

test("repo-scoped responses expose task progress for processing videos", async () => {
  const progress = {
    current_step: 4,
    total_steps: 7,
    task: "prepare_outputs",
    label: "Prepare outputs",
  };
  fakeBullJobProgress.set("finalize-session-processing", progress);
  videos.set("video-processing", {
    id: "video-processing",
    repositoryId: "repo-1",
    status: VideoStatus.PROCESSING,
    durationSec: null,
    resolutionWidth: null,
    resolutionHeight: null,
    fps: null,
    codec: null,
    recordedAt: new Date("2026-04-13T01:02:03.000Z"),
    thumbnailPath: null,
    dashboardVideoPath: null,
    vlmVideoPath: null,
    sizeBytes: null,
    vlmSha256: null,
    recorder: "alice",
    semanticMetadata: null,
    createdAt: new Date("2026-04-13T01:05:00.000Z"),
    recordingSessionId: "session-processing",
    errorMessage: null,
    processingStartedAt: new Date("2026-04-13T01:03:00.000Z"),
    processingCompletedAt: null,
  });

  const listResponse = await service.listRepositoryVideos(repository, {
    page: 1,
    limit: 20,
    status: VideoStatus.PROCESSING,
    sort_by: "recorded_at",
    sort_order: "desc",
  });
  assert.equal(listResponse.total, 1);
  assert.deepEqual(listResponse.data[0]!.processing_progress, progress);

  const detailResponse = await service.getRepositoryVideoDetail(
    "repo-1",
    repository,
    "video-processing",
  );
  assert.deepEqual(detailResponse.processing_progress, progress);

  const statusResponse = await service.getRepositoryVideoStatus("repo-1", "video-processing");
  assert.deepEqual(statusResponse.progress, progress);
  assert.equal(statusResponse.processing_started_at, "2026-04-13T01:03:00.000Z");
  assert.equal(statusResponse.processing_completed_at, null);
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

test("getRepositoryManifest returns completed videos with download metadata and no internal paths", async () => {
  const response = await repositoriesService.getRepositoryManifest(
    repositoryAccess({
      id: repository.id,
      name: repository.name,
      ownerId: repository.ownerId,
      visibility: repository.visibility,
      description: repository.description,
      tags: repository.tags,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    }),
    {
      page: 1,
      limit: 1,
    },
  );

  assert.deepEqual(response, {
    manifest_version: "1",
    repository: {
      id: "repo-1",
      owner_id: "alice",
      name: "daily-kitchen",
      visibility: "private",
      my_role: "read",
    },
    default_artifact: "vlm_video",
    pagination: {
      total: 2,
      page: 1,
      limit: 1,
      has_next: true,
    },
    videos: [
      {
        video_id: "video-1",
        recorded_at: "2026-04-12T01:02:03.000Z",
        duration_sec: 14.2,
        resolution_width: 1280,
        resolution_height: 720,
        fps: 30,
        codec: "h264",
        scene_summary: null,
        clip_segments: null,
        artifacts: {
          vlm_video: {
            download_url: "/api/v1/repositories/repo-1/videos/video-1/download",
            size_bytes: 42,
            sha256: "a".repeat(64),
            content_type: "video/mp4",
          },
          thumbnail: {
            download_url: "/api/v1/repositories/repo-1/videos/video-1/thumbnail",
            content_type: "image/jpeg",
          },
        },
      },
    ],
  });
  const firstVideo = response.videos[0]!;
  assert.equal("vlmVideoPath" in firstVideo, false);
  assert.equal("thumbnailPath" in firstVideo, false);

  const secondPage = await repositoriesService.getRepositoryManifest(
    repositoryAccess({
      id: repository.id,
      name: repository.name,
      ownerId: repository.ownerId,
      visibility: repository.visibility,
      description: repository.description,
      tags: repository.tags,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
    }),
    {
      page: 2,
      limit: 1,
    },
  );

  assert.equal(secondPage.pagination.has_next, false);
  assert.deepEqual(secondPage.videos[0], {
    video_id: "video-3",
    recorded_at: "2026-04-11T09:30:00.000Z",
    duration_sec: 9.5,
    resolution_width: 1920,
    resolution_height: 1080,
    fps: 60,
    codec: "h265",
    scene_summary: "Kitchen prep",
    clip_segments: [{ start_sec: 0, end_sec: 9.5 }],
    artifacts: {
      vlm_video: {
        download_url: "/api/v1/repositories/repo-1/videos/video-3/download",
        size_bytes: 84,
        sha256: "b".repeat(64),
        content_type: "video/mp4",
      },
      thumbnail: null,
    },
  });
});

test("getRepositoryManifest returns an empty manifest page for repositories without completed videos", async () => {
  const response = await repositoriesService.getRepositoryManifest(
    repositoryAccess({
      id: "repo-2",
      name: "public-repo",
      ownerId: "bob",
      visibility: "public",
      description: null,
      tags: [],
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    }),
    {
      page: 1,
      limit: 50,
    },
  );

  assert.deepEqual(response, {
    manifest_version: "1",
    repository: {
      id: "repo-2",
      owner_id: "bob",
      name: "public-repo",
      visibility: "public",
      my_role: "read",
    },
    default_artifact: "vlm_video",
    pagination: {
      total: 0,
      page: 1,
      limit: 50,
      has_next: false,
    },
    videos: [],
  });
});

test("getRepositoryManifest throws when a completed video lacks artifact metadata", async () => {
  videos.set("video-bad", {
    id: "video-bad",
    repositoryId: "repo-1",
    status: VideoStatus.COMPLETED,
    durationSec: 4,
    resolutionWidth: 640,
    resolutionHeight: 360,
    fps: 24,
    codec: "h264",
    recordedAt: new Date("2026-04-10T00:00:00.000Z"),
    thumbnailPath: null,
    dashboardVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", ".dashboard", "video-bad.mp4"),
    vlmVideoPath: path.join(targetDirectory, "alice", "daily-kitchen", "video-bad.mp4"),
    sizeBytes: null,
    vlmSha256: null,
    recorder: "alice",
    semanticMetadata: null,
    createdAt: new Date("2026-04-10T00:01:00.000Z"),
    recordingSessionId: "session-bad",
    errorMessage: null,
    processingStartedAt: new Date("2026-04-10T00:00:30.000Z"),
    processingCompletedAt: new Date("2026-04-10T00:00:50.000Z"),
  });

  await assert.rejects(
    () =>
      repositoriesService.getRepositoryManifest(
        repositoryAccess({
          id: repository.id,
          name: repository.name,
          ownerId: repository.ownerId,
          visibility: repository.visibility,
          description: repository.description,
          tags: repository.tags,
          createdAt: repository.createdAt,
          updatedAt: repository.updatedAt,
        }),
        {
          page: 1,
          limit: 50,
        },
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 500 &&
      error.code === "INTERNAL_ERROR",
  );
});

test("repo-scoped download requires available completed artifacts", async () => {
  await assert.rejects(
    () => service.getRepositoryVideoDownload("repo-2", "video-2"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND",
  );
});

test("repo-scoped thumbnail requires an available thumbnail file", async () => {
  await assert.rejects(
    () => service.getRepositoryVideoThumbnail("repo-1", "video-3"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "NOT_FOUND",
  );
});
