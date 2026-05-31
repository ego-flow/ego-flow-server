import assert from "node:assert/strict";
import path from "path";
import { beforeEach, test } from "node:test";
import { RecordingSessionStatus, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;

let capturedProcessor: ((job: any) => Promise<void>) | null = null;
let capturedHandlers: Map<string, (...args: any[]) => unknown> | null = null;

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
  if (request === "bullmq") {
    return {
      Job: class FakeJob {},
      Worker: class FakeWorker {
        handlers = new Map<string, (...args: unknown[]) => void>();

        constructor(
          _queueName: string,
          processor: (job: any) => Promise<void>,
          _options: unknown,
        ) {
          capturedProcessor = processor;
          capturedHandlers = this.handlers;
        }

        on(event: string, handler: (...args: unknown[]) => void) {
          this.handlers.set(event, handler);
          return this;
        }
      },
    };
  }

  return originalLoad(request, parent, isMain);
}) as typeof moduleLoader._load;

const videoUpdateCalls: Array<{ data: Record<string, unknown> }> = [];
const recordingSessionUpdateCalls: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
const recordingSegmentUpdateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
let segmentStatus: RecordingSegmentStatus = RecordingSegmentStatus.WRITE_DONE;

const session = {
  id: "session-1",
  repositoryId: "repo-1",
  ownerId: "alice",
  userId: "alice",
  deviceType: "meta-rayban",
  streamPath: "live/repo-name",
  status: RecordingSessionStatus.CLOSED,
  targetDirectory: "/data/root",
  readyAt: null as Date | null,
  createdAt: new Date("2026-04-14T09:59:00.000Z"),
};

const fakePrisma: any = {
  recordingSession: {
    findUnique: async () => session,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      recordingSessionUpdateCalls.push(args);
      return {
        ...session,
        ...args.data,
      };
    },
  },
  recordingSegment: {
    findUnique: async () => ({
      id: "segment-1",
      recordingSessionId: "session-1",
      rawPath: "/data/raw/live/repo-name/segment-1.mp4",
      status: segmentStatus,
    }),
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      recordingSegmentUpdateManyCalls.push(args);

      if (args.where.status && args.where.status !== segmentStatus) {
        return { count: 0 };
      }
      if (args.data.status) {
        segmentStatus = args.data.status as RecordingSegmentStatus;
      }

      return { count: 1 };
    },
  },
  video: {
    findUnique: async () => null,
    findMany: async () => [
      {
        recorder: "alice",
      },
    ],
    create: async (args: { data: Record<string, unknown> }) => {
      videoUpdateCalls.push(args);
      return {
        id: args.data.id,
        ...args.data,
      };
    },
  },
  repoMember: {
    findMany: async () => [
      {
        userId: "alice",
        role: "admin",
      },
    ],
  },
  repository: {
    findUnique: async () => ({
      contributors: [],
    }),
    update: async () => null,
  },
  $queryRaw: async () => [{ id: "repo-1" }],
  $transaction: async (operations: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>)) =>
    typeof operations === "function" ? operations(fakePrisma) : Promise.all(operations),
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const encoding = require("../src/workers/encoding") as typeof import("../src/workers/encoding");
const ffprobeLib = require("../src/lib/ffprobe") as typeof import("../src/lib/ffprobe");
const fileUtils = require("../src/lib/file-utils") as typeof import("../src/lib/file-utils");
const { createRecordingFinalizeWorker } =
  require("../src/workers/recording-finalize.worker") as typeof import("../src/workers/recording-finalize.worker");

const originalBuildOutputPaths = encoding.buildOutputPaths;
const originalEnsureOutputDirectories = encoding.ensureOutputDirectories;
const originalEncodeVlmVideo = encoding.encodeVlmVideo;
const originalEncodeDashboardVideo = encoding.encodeDashboardVideo;
const originalEncodeThumbnail = encoding.encodeThumbnail;
const originalProbeVideoMetadata = ffprobeLib.probeVideoMetadata;
const originalWaitForStableFile = fileUtils.waitForStableFile;
const originalComputeFileDigestAndSize = fileUtils.computeFileDigestAndSize;

beforeEach(() => {
  capturedProcessor = null;
  capturedHandlers = null;
  videoUpdateCalls.length = 0;
  recordingSessionUpdateCalls.length = 0;
  recordingSegmentUpdateManyCalls.length = 0;
  segmentStatus = RecordingSegmentStatus.WRITE_DONE;
  session.readyAt = null;

  (encoding as any).buildOutputPaths = originalBuildOutputPaths;
  (encoding as any).ensureOutputDirectories = originalEnsureOutputDirectories;
  (encoding as any).encodeVlmVideo = originalEncodeVlmVideo;
  (encoding as any).encodeDashboardVideo = originalEncodeDashboardVideo;
  (encoding as any).encodeThumbnail = originalEncodeThumbnail;
  (ffprobeLib as any).probeVideoMetadata = originalProbeVideoMetadata;
  (fileUtils as any).waitForStableFile = originalWaitForStableFile;
  (fileUtils as any).computeFileDigestAndSize = originalComputeFileDigestAndSize;
});

test("recording finalize stores VLM SHA-256 and size metadata after encoding", async () => {
  const outputRoot = "/data/root/datasets";
  const outputs = {
    vlmVideoPath: path.join(outputRoot, "alice", "repo-name", "video-1.mp4"),
    dashboardVideoPath: path.join(outputRoot, "alice", "repo-name", ".dashboard", "video-1.mp4"),
    thumbnailPath: path.join(outputRoot, "alice", "repo-name", ".thumbnails", "video-1.jpg"),
  };
  const encodeCalls: string[] = [];

  (encoding as any).buildOutputPaths = (() => outputs) as typeof encoding.buildOutputPaths;
  (encoding as any).ensureOutputDirectories = (async () => {}) as typeof encoding.ensureOutputDirectories;
  (encoding as any).encodeVlmVideo = (async (_inputPath: string, outputPath: string) => {
    encodeCalls.push(outputPath);
  }) as typeof encoding.encodeVlmVideo;
  (encoding as any).encodeDashboardVideo = (async (_inputPath: string, outputPath: string) => {
    encodeCalls.push(outputPath);
  }) as typeof encoding.encodeDashboardVideo;
  (encoding as any).encodeThumbnail = (async (_inputPath: string, outputPath: string) => {
    encodeCalls.push(outputPath);
  }) as typeof encoding.encodeThumbnail;
  (ffprobeLib as any).probeVideoMetadata = (async () => ({
    durationSec: 8,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    fps: 30,
    codec: "h264",
    recordedAt: new Date("2026-04-13T00:00:00.000Z"),
  })) as typeof ffprobeLib.probeVideoMetadata;
  (fileUtils as any).waitForStableFile = (async () => {}) as typeof fileUtils.waitForStableFile;
  (fileUtils as any).computeFileDigestAndSize = (async (filePath: string) => {
    assert.equal(filePath, outputs.vlmVideoPath);
    return {
      sha256: "a".repeat(64),
      sizeBytes: 1234n,
    };
  }) as typeof fileUtils.computeFileDigestAndSize;

  createRecordingFinalizeWorker();
  assert.ok(capturedProcessor);

  const progressUpdates: number[] = [];
  await capturedProcessor?.({
    data: {
      recordingSessionId: "session-1",
      videoId: "video-1",
      repositoryId: "repo-1",
      ownerId: "alice",
      repoName: "repo-name",
      targetDirectory: outputRoot,
    },
    updateProgress: async (value: number) => {
      progressUpdates.push(value);
    },
  });

  assert.deepEqual(encodeCalls, [
    outputs.vlmVideoPath,
    outputs.dashboardVideoPath,
    outputs.thumbnailPath,
  ]);

  const completedUpdate = videoUpdateCalls.at(-1);
  assert.ok(completedUpdate);
  assert.equal(completedUpdate?.data.vlmVideoPath, outputs.vlmVideoPath);
  assert.equal(completedUpdate?.data.sizeBytes, 1234n);
  assert.equal(completedUpdate?.data.vlmSha256, "a".repeat(64));
  assert.equal(completedUpdate?.data.recorder, "alice");
  assert.equal(completedUpdate?.data.status, VideoStatus.COMPLETED);
  assert.equal(recordingSessionUpdateCalls.length, 0);
  assert.deepEqual(progressUpdates, [5, 15, 35, 90, 100]);
  assert.deepEqual(
    recordingSegmentUpdateManyCalls.map((call) => call.data.status),
    [RecordingSegmentStatus.PROCESSING, RecordingSegmentStatus.COMPLETED],
  );
});

test("recording finalize falls back to session timing when ffprobe recordedAt is missing", async () => {
  const outputRoot = "/data/root/datasets";
  const outputs = {
    vlmVideoPath: path.join(outputRoot, "alice", "repo-name", "video-1.mp4"),
    dashboardVideoPath: path.join(outputRoot, "alice", "repo-name", ".dashboard", "video-1.mp4"),
    thumbnailPath: path.join(outputRoot, "alice", "repo-name", ".thumbnails", "video-1.jpg"),
  };

  session.readyAt = new Date("2026-04-14T10:00:00.000Z");

  (encoding as any).buildOutputPaths = (() => outputs) as typeof encoding.buildOutputPaths;
  (encoding as any).ensureOutputDirectories = (async () => {}) as typeof encoding.ensureOutputDirectories;
  (encoding as any).encodeVlmVideo = (async () => {}) as typeof encoding.encodeVlmVideo;
  (encoding as any).encodeDashboardVideo = (async () => {}) as typeof encoding.encodeDashboardVideo;
  (encoding as any).encodeThumbnail = (async () => {}) as typeof encoding.encodeThumbnail;
  (ffprobeLib as any).probeVideoMetadata = (async () => ({
    durationSec: 8,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    fps: 30,
    codec: "h264",
    recordedAt: null,
  })) as typeof ffprobeLib.probeVideoMetadata;
  (fileUtils as any).waitForStableFile = (async () => {}) as typeof fileUtils.waitForStableFile;
  (fileUtils as any).computeFileDigestAndSize = (async () => ({
    sha256: "a".repeat(64),
    sizeBytes: 1234n,
  })) as typeof fileUtils.computeFileDigestAndSize;

  createRecordingFinalizeWorker();
  assert.ok(capturedProcessor);

  await capturedProcessor?.({
    data: {
      recordingSessionId: "session-1",
      videoId: "video-1",
      repositoryId: "repo-1",
      ownerId: "alice",
      repoName: "repo-name",
      targetDirectory: outputRoot,
    },
    updateProgress: async () => {},
  });

  const metadataUpdate = videoUpdateCalls[0];
  assert.ok(metadataUpdate);
  assert.equal(metadataUpdate?.data.recordedAt, session.readyAt);
});

test("recording finalize ignores PROCESSING segment instead of resuming without a WRITE_DONE claim", async () => {
  segmentStatus = RecordingSegmentStatus.PROCESSING;
  let waitCalled = false;

  (fileUtils as any).waitForStableFile = (async () => {
    waitCalled = true;
  }) as typeof fileUtils.waitForStableFile;

  createRecordingFinalizeWorker();
  assert.ok(capturedProcessor);

  await capturedProcessor?.({
    data: {
      recordingSessionId: "session-1",
      videoId: "video-1",
      repositoryId: "repo-1",
      ownerId: "alice",
      repoName: "repo-name",
      targetDirectory: "/data/root/datasets",
    },
    updateProgress: async () => {},
  });

  assert.equal(waitCalled, false);
  assert.equal(videoUpdateCalls.length, 0);
  assert.equal(recordingSegmentUpdateManyCalls.length, 0);
});

test("recording finalize resets PROCESSING segment to WRITE_DONE before BullMQ retry", async () => {
  (fileUtils as any).waitForStableFile = (async () => {
    throw new Error("raw file not stable");
  }) as typeof fileUtils.waitForStableFile;

  createRecordingFinalizeWorker();
  assert.ok(capturedProcessor);

  await assert.rejects(
    capturedProcessor?.({
      data: {
        recordingSessionId: "session-1",
        videoId: "video-1",
        repositoryId: "repo-1",
        ownerId: "alice",
        repoName: "repo-name",
        targetDirectory: "/data/root/datasets",
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
      updateProgress: async () => {},
    }),
    /raw file not stable/,
  );

  assert.deepEqual(
    recordingSegmentUpdateManyCalls.map((call) => call.data.status),
    [RecordingSegmentStatus.PROCESSING, RecordingSegmentStatus.WRITE_DONE],
  );
  assert.equal(segmentStatus, RecordingSegmentStatus.WRITE_DONE);
});

test("recording finalize final failure marks segment failed and creates failed video", async () => {
  createRecordingFinalizeWorker();
  const failedHandler = capturedHandlers?.get("failed");
  assert.ok(failedHandler);

  failedHandler(
    {
      data: {
        recordingSessionId: "session-1",
        videoId: "video-1",
        repositoryId: "repo-1",
        ownerId: "alice",
        repoName: "repo-name",
        targetDirectory: "/data/root/datasets",
      },
      attemptsMade: 3,
      opts: { attempts: 3 },
    },
    new Error("encoding failed"),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(segmentStatus, RecordingSegmentStatus.FAILED);
  assert.equal(videoUpdateCalls.length, 1);
  assert.equal(videoUpdateCalls[0]?.data.status, VideoStatus.FAILED);
  assert.equal(videoUpdateCalls[0]?.data.errorMessage, "encoding failed");
});
