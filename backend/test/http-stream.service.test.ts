import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  RecordingSegmentStatus,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
  VideoStatus,
} from "@prisma/client";

import { FakeRedis } from "./helpers/fake-redis";
import type { PublishTicketRecord, RecordingSessionLiveCache } from "../src/types/stream";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
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

const fakeRedis = new FakeRedis();
const prismaCalls = {
  sessionFindUnique: [] as Array<unknown>,
  sessionFindMany: [] as Array<unknown>,
  sessionUpdateMany: [] as Array<unknown>,
  segmentCreate: [] as Array<unknown>,
  segmentFindUnique: [] as Array<unknown>,
  segmentUpdateMany: [] as Array<unknown>,
  videoUpsert: [] as Array<unknown>,
};

const session = {
  id: "11111111-1111-4111-8111-111111111111",
  repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
  ownerId: "admin",
  userId: "maintainer-1",
  deviceType: "phone_android",
  ingestType: RecordingSessionIngestType.HTTP,
  streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
  status: RecordingSessionStatus.PENDING,
  targetDirectory: "/data/datasets",
  readyAt: null as Date | null,
  closedAt: null as Date | null,
  endReason: null as RecordingSessionEndReason | null,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
};

let currentSession: any = { ...session };
let currentSegment: {
  id: string;
  recordingSessionId: string;
  rawPath: string;
  status: RecordingSegmentStatus;
  completedAt: Date | null;
} | null = null;
let forcedFindManySessions: Array<any> | null = null;
let tempRoot = "";

const fakePrisma: any = {
  $transaction: async (callbackOrQueries: unknown) => {
    if (typeof callbackOrQueries === "function") {
      return callbackOrQueries(fakePrisma);
    }
    return Promise.all(callbackOrQueries as Array<Promise<unknown>>);
  },
  recordingSessions: {
    findUnique: async (args?: unknown) => {
      prismaCalls.sessionFindUnique.push(args);
      return currentSession;
    },
    findMany: async (args?: unknown) => {
      prismaCalls.sessionFindMany.push(args);
      if (forcedFindManySessions) {
        return forcedFindManySessions;
      }
      return currentSession.status === RecordingSessionStatus.STREAMING ? [currentSession] : [];
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      prismaCalls.sessionUpdateMany.push(args);
      if (args.where.status && args.where.status !== currentSession.status) {
        return { count: 0 };
      }
      currentSession = {
        ...currentSession,
        ...args.data,
      } as typeof currentSession;
      return { count: 1 };
    },
  },
  recordingSegments: {
    create: async (args: { data: Record<string, unknown> }) => {
      prismaCalls.segmentCreate.push(args);
      currentSegment = {
        id: "segment-1",
        recordingSessionId: String(args.data.recordingSessionId),
        rawPath: String(args.data.rawPath),
        status: args.data.status as RecordingSegmentStatus,
        completedAt: null,
      };
      return currentSegment;
    },
    findUnique: async (args?: unknown) => {
      prismaCalls.segmentFindUnique.push(args);
      return currentSegment;
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      prismaCalls.segmentUpdateMany.push(args);
      if (!currentSegment || (args.where.status && args.where.status !== currentSegment.status)) {
        return { count: 0 };
      }
      currentSegment = {
        ...currentSegment,
        ...args.data,
      } as typeof currentSegment;
      return { count: 1 };
    },
  },
  videos: {
    upsert: async (args: unknown) => {
      prismaCalls.videoUpsert.push(args);
      return { id: "video-1" };
    },
  },
};

(globalThis as any).__egoflowRedis = fakeRedis;
(globalThis as any).__egoflowPrisma = fakePrisma;

const { runtimeConfig } =
  require("../src/config/runtime") as typeof import("../src/config/runtime");
const { httpStreamService } =
  require("../src/services/http-stream.service") as typeof import("../src/services/http-stream.service");
const { streamOwnershipService } =
  require("../src/lib/streaming/stream-ownership") as typeof import("../src/lib/streaming/stream-ownership");
const { recordingSessionService } =
  require("../src/lib/streaming/recording-session") as typeof import("../src/lib/streaming/recording-session");
const { reconcileHttpUploads } =
  require("../src/lib/streaming/http-upload-session") as typeof import("../src/lib/streaming/http-upload-session");

const originalConsumePublishTicket = streamOwnershipService.consumePublishTicket;
const originalTryEnqueueFinalize = recordingSessionService.tryEnqueueFinalize;
const mutableRuntimeConfig = runtimeConfig as unknown as { RAW_ROOT: string };
const originalRawRoot = mutableRuntimeConfig.RAW_ROOT;

const resetCalls = () => {
  for (const calls of Object.values(prismaCalls)) {
    calls.length = 0;
  }
};

beforeEach(async () => {
  fakeRedis.clear();
  resetCalls();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egoflow-http-stream-"));
  mutableRuntimeConfig.RAW_ROOT = tempRoot;
  currentSession = { ...session };
  currentSegment = null;
  forcedFindManySessions = null;
  streamOwnershipService.consumePublishTicket = originalConsumePublishTicket;
  recordingSessionService.tryEnqueueFinalize = originalTryEnqueueFinalize;
});

afterEach(async () => {
  mutableRuntimeConfig.RAW_ROOT = originalRawRoot;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test("start consumes an HTTP publish ticket and creates upload cache", async () => {
  const consumeCalls: Array<unknown> = [];
  streamOwnershipService.consumePublishTicket = async (streamPath, ticketId, options) => {
    consumeCalls.push({ streamPath, ticketId, options });
    return {
      ok: true,
      ticketId: "ticket-1",
      ticket: {
        recordingSessionId: session.id,
        repositoryId: session.repositoryId,
        userId: session.userId,
        ingestType: "HTTP",
        streamPath: session.streamPath,
        status: "consumed",
      } satisfies PublishTicketRecord,
    };
  };

  const response = await httpStreamService.start(session.id, session.userId, {
    publish_ticket: "ticket-1",
  });

  assert.deepEqual(response, {
    recording_session_id: session.id,
    status: "STREAMING",
    bytes_received: 0,
    last_sequence: null,
  });
  assert.equal((consumeCalls[0] as any).options.expectedIngestType, RecordingSessionIngestType.HTTP);
  assert.equal(currentSession.status, RecordingSessionStatus.STREAMING);
  assert.equal(currentSegment?.status, RecordingSegmentStatus.WRITING);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), [session.id]);
  const cache = fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${session.id}`);
  const expectedRawPath = path.join(tempRoot, "http", "test2", session.id, "recording.mp4");
  assert.equal(cache?.ownerId, session.ownerId);
  assert.equal(cache?.ingestType, "HTTP");
  assert.equal(cache?.status, "STREAMING");
  assert.equal(cache?.bytesReceived, 0);
  assert.equal(cache?.lastSequence, null);
  assert.equal(cache?.rawPath, expectedRawPath);
  assert.equal(currentSegment?.rawPath, expectedRawPath);
});

test("appendChunk validates hot path from Redis and does not query DB", async () => {
  const rawPath = path.join(tempRoot, "recording.mp4");
  fakeRedis.setJson(`stream:recording:${session.id}`, {
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: "test2",
    userId: session.userId,
    deviceType: session.deviceType,
    ingestType: "HTTP",
    status: "STREAMING",
    rawPath,
    bytesReceived: 0,
    lastSequence: null,
    lastChunkAt: Date.now(),
  } satisfies RecordingSessionLiveCache);

  const response = await httpStreamService.appendChunk(session.id, session.userId, {
    sequence: 0,
    offset: 0,
    chunk: Buffer.from("hello"),
  });

  assert.deepEqual(response, {
    recording_session_id: session.id,
    bytes_received: 5,
    last_sequence: 0,
  });
  assert.equal(await fs.readFile(rawPath, "utf8"), "hello");
  assert.equal(prismaCalls.sessionFindUnique.length, 0);
  assert.equal(prismaCalls.sessionFindMany.length, 0);
  assert.equal(prismaCalls.segmentFindUnique.length, 0);
  const cache = fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${session.id}`);
  assert.equal(cache?.bytesReceived, 5);
  assert.equal(cache?.lastSequence, 0);
});

test("finish validates total bytes, closes session, and enqueues finalize", async () => {
  const rawPath = path.join(tempRoot, "recording.mp4");
  await fs.writeFile(rawPath, "hello");
  currentSession = {
    ...session,
    status: RecordingSessionStatus.STREAMING,
    readyAt: new Date(),
  };
  currentSegment = {
    id: "segment-1",
    recordingSessionId: session.id,
    rawPath,
    status: RecordingSegmentStatus.WRITING,
    completedAt: null,
  };
  fakeRedis.setJson(`stream:recording:${session.id}`, {
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: "test2",
    userId: session.userId,
    deviceType: session.deviceType,
    ingestType: "HTTP",
    status: "STREAMING",
    rawPath,
    bytesReceived: 5,
    lastSequence: 0,
    lastChunkAt: Date.now(),
  } satisfies RecordingSessionLiveCache);
  await fakeRedis.sadd("stream:active:sessions", session.id);
  const enqueueCalls: string[] = [];
  recordingSessionService.tryEnqueueFinalize = async (recordingSessionId: string) => {
    enqueueCalls.push(recordingSessionId);
    return true;
  };

  const response = await httpStreamService.finish(session.id, session.userId, {
    total_bytes: 5,
  });

  assert.deepEqual(response, {
    recording_session_id: session.id,
    status: "CLOSED",
    segment_status: "WRITE_DONE",
    bytes_received: 5,
  });
  assert.equal(currentSession.status, RecordingSessionStatus.CLOSED);
  assert.equal(currentSession.endReason, RecordingSessionEndReason.NORMAL_DISCONNECT);
  assert.equal(currentSegment?.status, RecordingSegmentStatus.WRITE_DONE);
  assert.deepEqual(enqueueCalls, [session.id]);
  assert.equal(await fakeRedis.get(`stream:recording:${session.id}`), null);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
});

test("reconcile does not create failed video when timeout failure loses the state claim", async () => {
  const rawPath = path.join(tempRoot, "recording.mp4");
  forcedFindManySessions = [
    {
      ...session,
      status: RecordingSessionStatus.STREAMING,
      readyAt: new Date(),
    },
  ];
  currentSession = {
    ...session,
    status: RecordingSessionStatus.CLOSED,
    readyAt: new Date(),
    closedAt: new Date(),
    endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
  };
  currentSegment = {
    id: "segment-1",
    recordingSessionId: session.id,
    rawPath,
    status: RecordingSegmentStatus.WRITE_DONE,
    completedAt: new Date(),
  };

  await reconcileHttpUploads();

  assert.equal(currentSession.status, RecordingSessionStatus.CLOSED);
  assert.equal(currentSession.endReason, RecordingSessionEndReason.NORMAL_DISCONNECT);
  assert.equal(currentSegment?.status, RecordingSegmentStatus.WRITE_DONE);
  assert.equal(prismaCalls.videoUpsert.length, 0);
});

test("reconcile does not enqueue finalize when timeout recovery loses the state claim", async () => {
  const rawPath = path.join(tempRoot, "recording.mp4");
  await fs.writeFile(rawPath, "hello");
  forcedFindManySessions = [
    {
      ...session,
      status: RecordingSessionStatus.STREAMING,
      readyAt: new Date(),
    },
  ];
  currentSession = {
    ...session,
    status: RecordingSessionStatus.CLOSED,
    readyAt: new Date(),
    closedAt: new Date(),
    endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
  };
  currentSegment = {
    id: "segment-1",
    recordingSessionId: session.id,
    rawPath,
    status: RecordingSegmentStatus.WRITE_DONE,
    completedAt: new Date(),
  };
  fakeRedis.setJson(`stream:recording:${session.id}`, {
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: "test2",
    userId: session.userId,
    deviceType: session.deviceType,
    ingestType: "HTTP",
    status: "STREAMING",
    rawPath,
    bytesReceived: 5,
    lastSequence: 0,
    lastChunkAt: Date.now() - 15_000,
  } satisfies RecordingSessionLiveCache);
  const enqueueCalls: string[] = [];
  recordingSessionService.tryEnqueueFinalize = async (recordingSessionId: string) => {
    enqueueCalls.push(recordingSessionId);
    return true;
  };

  await reconcileHttpUploads();

  assert.equal(currentSession.status, RecordingSessionStatus.CLOSED);
  assert.equal(currentSession.endReason, RecordingSessionEndReason.NORMAL_DISCONNECT);
  assert.equal(currentSegment?.status, RecordingSegmentStatus.WRITE_DONE);
  assert.deepEqual(enqueueCalls, []);
});

test("reconcile marks timed out missing raw file as failed and creates failed video", async () => {
  const rawPath = path.join(tempRoot, "missing.mp4");
  currentSession = {
    ...session,
    status: RecordingSessionStatus.STREAMING,
    readyAt: new Date(),
  };
  currentSegment = {
    id: "segment-1",
    recordingSessionId: session.id,
    rawPath,
    status: RecordingSegmentStatus.WRITING,
    completedAt: null,
  };
  fakeRedis.setJson(`stream:recording:${session.id}`, {
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repositoryName: "test2",
    userId: session.userId,
    deviceType: session.deviceType,
    ingestType: "HTTP",
    status: "STREAMING",
    rawPath,
    bytesReceived: 10,
    lastSequence: 0,
    lastChunkAt: Date.now() - 15_000,
  } satisfies RecordingSessionLiveCache);
  await fakeRedis.sadd("stream:active:sessions", session.id);

  await reconcileHttpUploads();

  assert.equal(currentSession.status, RecordingSessionStatus.CLOSED);
  assert.equal(currentSession.endReason, RecordingSessionEndReason.UNEXPECTED_DISCONNECT);
  assert.equal(currentSegment?.status, RecordingSegmentStatus.FAILED);
  assert.equal(prismaCalls.videoUpsert.length, 1);
  assert.equal((prismaCalls.videoUpsert[0] as any).create.status, VideoStatus.FAILED);
  assert.equal((prismaCalls.videoUpsert[0] as any).create.recordingSessionId, session.id);
  assert.equal(await fakeRedis.get(`stream:recording:${session.id}`), null);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
});
