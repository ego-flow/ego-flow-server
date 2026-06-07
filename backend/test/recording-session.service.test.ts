import assert from "node:assert/strict";
import {
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSegmentStatus,
  RecordingSessionStatus,
} from "@prisma/client";
import { beforeEach, test } from "node:test";

import type { PublishTicketRecord, RecordingSessionLiveCache } from "../src/types/stream";
import { FakeRedis } from "./helpers/fake-redis";

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
const fakePrisma: any = {
  $transaction: async (callbackOrQueries: unknown) => {
    if (typeof callbackOrQueries === "function") {
      return callbackOrQueries(fakePrisma);
    }
    return Promise.all(callbackOrQueries as Array<Promise<unknown>>);
  },
  recordingSessions: {
    findUnique: async (_args?: unknown) => null,
    update: async (_args?: unknown) => null,
    updateMany: async (_args?: unknown) => ({ count: 0 }),
  },
  recordingSegments: {
    count: async (_args?: unknown) => 0,
    findMany: async (_args?: unknown) => [],
    findUnique: async (_args?: unknown) => null,
    findFirst: async (_args?: unknown) => null,
    upsert: async (_args?: unknown) => null,
    create: async (_args?: unknown) => null,
    update: async (_args?: unknown) => null,
    updateMany: async (_args?: unknown) => ({ count: 0 }),
  },
  videos: {
    upsert: async (_args?: unknown) => ({ id: "video-1" }),
    findUnique: async (_args?: unknown) => null,
    create: async (_args?: unknown) => ({ id: "video-1" }),
    findMany: async (_args?: unknown) => [],
  },
};

(globalThis as any).__egoflowRedis = fakeRedis;
(globalThis as any).__egoflowPrisma = fakePrisma;

const { recordingSessionService } =
  require("../src/lib/streaming/recording-session") as typeof import("../src/lib/streaming/recording-session");
const { recordingsService } =
  require("../src/services/recordings.service") as typeof import("../src/services/recordings.service");
const { hooksService } =
  require("../src/services/hooks.service") as typeof import("../src/services/hooks.service");
const { streamOwnershipService } =
  require("../src/lib/streaming/stream-ownership") as typeof import("../src/lib/streaming/stream-ownership");
const { processingService } =
  require("../src/lib/processing/processing-queue") as typeof import("../src/lib/processing/processing-queue");

const originalGetLiveCacheByRecordingSessionId = recordingSessionService.getLiveCacheByRecordingSessionId;
const originalTryEnqueueFinalize = recordingSessionService.tryEnqueueFinalize;
const originalValidatePublishTicket = streamOwnershipService.validatePublishTicket;
const originalConsumePublishTicket = streamOwnershipService.consumePublishTicket;
const originalEnqueueRecordingFinalize = processingService.enqueueRecordingFinalize;
const originalGetActiveStreamPaths = (recordingSessionService as any).getActiveStreamPaths;

const ticketId = "ticket-1";
const ticket: PublishTicketRecord = {
  recordingSessionId: "session-1",
  repositoryId: "repo-1",
  userId: "user-1",
  ingestType: "MEDIAMTX",
  streamPath: "live/repo-name/session-1",
  status: "active",
};

beforeEach(() => {
  fakeRedis.clear();

  fakePrisma.recordingSessions.findUnique = async () => null;
  fakePrisma.recordingSessions.update = async () => null;
  fakePrisma.recordingSessions.updateMany = async () => ({ count: 0 });
  fakePrisma.recordingSegments.count = async () => 0;
  fakePrisma.recordingSegments.findMany = async () => [];
  fakePrisma.recordingSegments.findUnique = async () => null;
  fakePrisma.recordingSegments.findFirst = async () => null;
  fakePrisma.recordingSegments.upsert = async () => null;
  fakePrisma.recordingSegments.create = async () => null;
  fakePrisma.recordingSegments.update = async () => null;
  fakePrisma.recordingSegments.updateMany = async () => ({ count: 0 });
  fakePrisma.videos.upsert = async () => ({ id: "video-1" });
  fakePrisma.videos.findUnique = async () => null;
  fakePrisma.videos.create = async () => ({ id: "video-1" });
  fakePrisma.videos.findMany = async () => [];

  recordingSessionService.getLiveCacheByRecordingSessionId = originalGetLiveCacheByRecordingSessionId;
  recordingSessionService.tryEnqueueFinalize = originalTryEnqueueFinalize;
  streamOwnershipService.validatePublishTicket = originalValidatePublishTicket;
  streamOwnershipService.consumePublishTicket = originalConsumePublishTicket;
  processingService.enqueueRecordingFinalize = originalEnqueueRecordingFinalize;
  (recordingSessionService as any).getActiveStreamPaths = originalGetActiveStreamPaths;
});

test("handleStreamReady ignores STREAMING sessions instead of reconnecting them", async () => {
  const existingReadyAt = new Date("2026-04-09T00:00:00.000Z");
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: existingReadyAt,
  };
  const updateCalls: Array<unknown> = [];
  let consumeCalled = false;

  fakePrisma.recordingSessions.findUnique = async () => session;
  fakePrisma.recordingSessions.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  streamOwnershipService.validatePublishTicket = async () => ({
    ok: true,
    ticket,
    ticketId,
  });
  streamOwnershipService.consumePublishTicket = async () => {
    consumeCalled = true;
    return {
      ok: true,
      ticket: {
        ...ticket,
        status: "consumed",
      },
      ticketId,
    };
  };

  await hooksService.handleStreamReady({
    path: "live/repo-name/session-1",
    ticket: ticketId,
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(consumeCalled, false);
  assert.equal(fakeRedis.has("stream:recording:session-1"), false);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
});

test("handleStreamReady leaves DB and Redis untouched when ticket consume is rejected", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
  };
  const updateCalls: Array<unknown> = [];

  fakePrisma.recordingSessions.findUnique = async () => session;
  fakePrisma.recordingSessions.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  recordingSessionService.getLiveCacheByRecordingSessionId = async () => null;
  streamOwnershipService.validatePublishTicket = async () => ({
    ok: true,
    ticket,
    ticketId,
  });
  streamOwnershipService.consumePublishTicket = async () => ({
    ok: false,
    reason: "ticket-status-consumed",
    ticketId,
  });

  await hooksService.handleStreamReady({
    path: "live/repo-name/session-1",
    ticket: ticketId,
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(fakeRedis.has("stream:recording:session-1"), false);
});

test("handleStreamReady accepts an explicit ticket field when hook query is empty", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
  };
  const updateCalls: Array<unknown> = [];
  const validationTicketIds: Array<string | null | undefined> = [];
  const consumeTicketIds: Array<string | null | undefined> = [];

  fakePrisma.recordingSessions.findUnique = async () => session;
  fakePrisma.recordingSessions.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  recordingSessionService.getLiveCacheByRecordingSessionId = async () => null;
  streamOwnershipService.validatePublishTicket = async (_path: string, hookTicketId?: string | null) => {
    validationTicketIds.push(hookTicketId);
    return {
      ok: true,
      ticket,
      ticketId,
    };
  };
  streamOwnershipService.consumePublishTicket = async (_path: string, hookTicketId?: string | null) => {
    consumeTicketIds.push(hookTicketId);
    return {
      ok: true,
      ticket: {
        ...ticket,
        status: "consumed",
      },
      ticketId,
    };
  };

  await hooksService.handleStreamReady({
    path: "live/repo-name/session-1",
    ticket: ticketId,
  });

  assert.deepEqual(validationTicketIds, [ticketId]);
  assert.deepEqual(consumeTicketIds, [ticketId]);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), ["session-1"]);
  assert.deepEqual(fakeRedis.getJson<RecordingSessionLiveCache>("stream:recording:session-1"), {
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  });
  assert.equal(fakeRedis.getTtlSeconds("stream:recording:session-1"), 2 * 60 * 60);
});

test("handleStreamNotReady closes the streaming session and attempts finalize enqueue", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
    closedAt: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  let enqueueCalled = false;

  fakePrisma.recordingSessions.findUnique = async () => session;
  fakePrisma.recordingSessions.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  recordingSessionService.tryEnqueueFinalize = async () => {
    enqueueCalled = true;
    return true;
  };

  await fakeRedis.sadd("stream:active:sessions", "session-1");
  fakeRedis.setJson("stream:recording:session-1", {
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  await hooksService.handleStreamNotReady({
    path: "live/repo-name/session-1",
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.CLOSED);
  assert.ok(updateCalls[0]?.closedAt instanceof Date);
  assert.equal(updateCalls[0]?.endReason, RecordingSessionEndReason.UNEXPECTED_DISCONNECT);
  assert.equal(enqueueCalled, true);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
  assert.equal(await fakeRedis.get("stream:recording:session-1"), null);
});

test("recordCloseIntent stores NORMAL_DISCONNECT and stream-not-ready preserves it", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    closedAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
    video: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  let currentSession: any = session;

  fakePrisma.recordingSessions.findUnique = async () => currentSession;
  fakePrisma.recordingSessions.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    currentSession = {
      ...currentSession,
      ...args.data,
    };
    return currentSession;
  };

  recordingSessionService.tryEnqueueFinalize = async () => true;

  await recordingsService.recordCloseIntent("session-1", "user-1", {
    reason: RecordingSessionEndReason.NORMAL_DISCONNECT,
  });
  await hooksService.handleStreamNotReady({
    path: "live/repo-name/session-1",
  });

  assert.equal(updateCalls.length, 2);
  assert.deepEqual(updateCalls[0], {
    endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
  });
  assert.equal(updateCalls[1]?.status, RecordingSessionStatus.CLOSED);
  assert.ok(updateCalls[1]?.closedAt instanceof Date);
  assert.equal(updateCalls[1]?.endReason, RecordingSessionEndReason.NORMAL_DISCONNECT);
});

test("recordCloseIntent rejects non-owner requests", async () => {
  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    closedAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
    video: null,
  });

  await assert.rejects(
    recordingsService.recordCloseIntent("session-1", "user-2", {
      reason: RecordingSessionEndReason.NORMAL_DISCONNECT,
    }),
    { statusCode: 403 },
  );
});

test("handleSegmentComplete marks the segment WRITE_DONE and attempts finalize enqueue", async () => {
  const closedSession = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.CLOSED,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    closedAt: new Date("2026-04-09T00:01:00.000Z"),
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
    video: null,
  };
  const segment = {
    id: "segment-1",
    recordingSessionId: "session-1",
    rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
    status: RecordingSegmentStatus.WRITING,
  };
  const segmentUpdateCalls: Array<Record<string, unknown>> = [];
  const finalizeCalls: Array<string> = [];

  fakePrisma.recordingSessions.findUnique = async () => closedSession;
  fakePrisma.recordingSegments.findUnique = async () => ({
    ...segment,
    status: RecordingSegmentStatus.WRITING,
  });
  fakePrisma.recordingSegments.update = async (args: Record<string, unknown>) => {
    segmentUpdateCalls.push(args);
    return {
      ...segment,
      ...((args as any).data as Record<string, unknown>),
    };
  };
  recordingSessionService.tryEnqueueFinalize = async (recordingSessionId: string) => {
    finalizeCalls.push(recordingSessionId);
    return true;
  };

  await hooksService.handleSegmentComplete({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(segmentUpdateCalls.length, 1);
  assert.equal((segmentUpdateCalls[0] as any).data.status, RecordingSegmentStatus.WRITE_DONE);
  assert.deepEqual(finalizeCalls, ["session-1"]);
});

test("handleSegmentComplete does not create a segment when create hook was missed", async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  let finalizeCalled = false;

  fakePrisma.recordingSegments.findUnique = async () => null;
  fakePrisma.recordingSegments.create = async (args: Record<string, unknown>) => {
    createCalls.push(args);
    return args;
  };
  recordingSessionService.tryEnqueueFinalize = async () => {
    finalizeCalled = true;
    return true;
  };

  await hooksService.handleSegmentComplete({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(createCalls.length, 0);
  assert.equal(finalizeCalled, false);
});

test("tryEnqueueFinalize waits for stream-not-ready to close the session", async () => {
  let status: RecordingSessionStatus = RecordingSessionStatus.STREAMING;
  const enqueuePayloads: Array<{ recordingSessionId: string }> = [];

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    streamPath: "live/repo-name/session-1",
    status,
    targetDirectory: "/data/raw",
    endReason: null,
  });
  fakePrisma.recordingSegments.findUnique = async () => ({
    status: RecordingSegmentStatus.WRITE_DONE,
    rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });
  processingService.enqueueRecordingFinalize = async (payload: { recordingSessionId: string }) => {
    enqueuePayloads.push(payload);
    return { id: "fake-job" } as never;
  };

  assert.equal(await recordingSessionService.tryEnqueueFinalize("session-1"), false);
  assert.equal(enqueuePayloads.length, 0);

  status = RecordingSessionStatus.CLOSED;

  assert.equal(await recordingSessionService.tryEnqueueFinalize("session-1"), true);
  assert.equal(enqueuePayloads.length, 1);
  assert.equal(enqueuePayloads[0]?.recordingSessionId, "session-1");
});

test("handleSegmentCreate stores the single segment from stream path", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
  });
  fakePrisma.recordingSegments.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return {
      id: "segment-1",
      recordingSessionId: "session-1",
      rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
      status: RecordingSegmentStatus.WRITING,
    };
  };

  await hooksService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(upsertCalls.length, 1);
});

test("handleSegmentCreate only requires an existing session", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.CLOSED,
  });
  fakePrisma.recordingSegments.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return {
      id: "segment-1",
      recordingSessionId: "session-1",
      rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
      status: RecordingSegmentStatus.WRITING,
    };
  };

  await hooksService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0]?.where, { recordingSessionId: "session-1" });
  assert.equal(
    (upsertCalls[0]?.create as { status?: RecordingSegmentStatus })?.status,
    RecordingSegmentStatus.WRITING,
  );
});

test("handleSegmentCreate stores the segment without source metadata", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
  });
  fakePrisma.recordingSegments.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return {
      id: "segment-1",
      recordingSessionId: "session-1",
      rawPath: "/data/raw/live/repo-name/session-1/segment-0002.mp4",
      status: RecordingSegmentStatus.WRITING,
    };
  };

  await hooksService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0002.mp4",
  });

  assert.equal(upsertCalls.length, 1);
});

test("handleSegmentCreate ignores an additional segment for the same recording session", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
  });
  fakePrisma.recordingSegments.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return {
      id: "segment-1",
      recordingSessionId: "session-1",
      rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
      status: RecordingSegmentStatus.WRITING,
    };
  };

  await hooksService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0002.mp4",
  });

  assert.equal(upsertCalls.length, 1);
});

test("reconcile closes a broken streaming session when active path is missing", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    closedAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  let enqueueCalled = false;

  fakePrisma.recordingSessions.findMany = async () => [session];
  fakePrisma.recordingSessions.findUnique = async () => null;
  fakePrisma.recordingSessions.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  await fakeRedis.sadd("stream:active:sessions", "session-1");
  fakeRedis.setJson("stream:recording:session-1", {
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  recordingSessionService.tryEnqueueFinalize = async () => {
    enqueueCalled = true;
    return true;
  };
  (recordingSessionService as any).getActiveStreamPaths = async () => new Set<string>();

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.CLOSED);
  assert.ok(updateCalls[0]?.closedAt instanceof Date);
  assert.equal(updateCalls[0]?.endReason, RecordingSessionEndReason.UNEXPECTED_DISCONNECT);
  assert.equal(enqueueCalled, true);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
  assert.equal(await fakeRedis.get("stream:recording:session-1"), null);
});

test("reconcile closes a streaming session that already has a closed marker", async () => {
  const updateCalls: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];

  const session = {
    id: "session-empty",
    repositoryId: "repo-1",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/repo-name/session-empty",
    status: RecordingSessionStatus.STREAMING,
    endReason: RecordingSessionEndReason.NORMAL_DISCONNECT,
    createdAt: new Date(Date.now() - 60_000),
    readyAt: new Date(Date.now() - 55_000),
    closedAt: new Date(Date.now() - 40_000),
    video: null,
  };
  fakePrisma.recordingSessions.findMany = async () => [session];
  fakePrisma.recordingSessions.findUnique = async () => session;
  fakePrisma.recordingSessions.update = async (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    updateCalls.push(args);
    return args;
  };
  fakePrisma.recordingSegments.findUnique = async () => null;
  (recordingSessionService as any).getActiveStreamPaths = async () => null;

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.where.id, "session-empty");
  assert.equal(updateCalls[0]?.data.status, RecordingSessionStatus.CLOSED);
  assert.equal(updateCalls[0]?.data.endReason, RecordingSessionEndReason.NORMAL_DISCONNECT);
});

test("handleSegmentComplete ignores late completion for a terminal segment", async () => {
  const updateCalls: Array<Record<string, unknown>> = [];
  let finalizeCalled = false;

  fakePrisma.recordingSessions.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.CLOSED,
  });
  fakePrisma.recordingSegments.findUnique = async () => ({
    id: "segment-1",
    recordingSessionId: "session-1",
    rawPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
    status: RecordingSegmentStatus.FAILED,
  });
  fakePrisma.recordingSegments.update = async (args: Record<string, unknown>) => {
    updateCalls.push(args);
    return args;
  };
  recordingSessionService.tryEnqueueFinalize = async () => {
    finalizeCalled = true;
    return true;
  };

  await hooksService.handleSegmentComplete({
    path: "live/repo-name/session-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(finalizeCalled, false);
});
