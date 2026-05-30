import assert from "node:assert/strict";
import { RecordingSessionEndReason, RecordingSegmentStatus, RecordingSessionStatus } from "@prisma/client";
import { beforeEach, test } from "node:test";

import type { PublishTicketRecord, RecordingSessionLiveCache } from "../src/types/stream";
import { FakeRedis } from "./helpers/fake-redis";

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
  recordingSession: {
    findUnique: async (_args?: unknown) => null,
    update: async (_args?: unknown) => null,
    updateMany: async (_args?: unknown) => ({ count: 0 }),
  },
  recordingSegment: {
    count: async (_args?: unknown) => 0,
    findFirst: async (_args?: unknown) => null,
    aggregate: async (_args?: unknown) => ({ _max: { sequence: null } }),
    upsert: async (_args?: unknown) => null,
    create: async (_args?: unknown) => null,
    update: async (_args?: unknown) => null,
  },
};

(globalThis as any).__egoflowRedis = fakeRedis;
(globalThis as any).__egoflowPrisma = fakePrisma;

const { recordingSessionService } =
  require("../src/services/recording-session.service") as typeof import("../src/services/recording-session.service");
const { streamOwnershipService } =
  require("../src/services/stream-ownership.service") as typeof import("../src/services/stream-ownership.service");

const originalGetLiveCacheByRecordingSessionId = recordingSessionService.getLiveCacheByRecordingSessionId;
const originalTryEnqueueFinalize = recordingSessionService.tryEnqueueFinalize;
const originalValidatePublishTicket = streamOwnershipService.validatePublishTicket;
const originalConsumePublishTicket = streamOwnershipService.consumePublishTicket;
const originalGetActiveStreamPaths = (recordingSessionService as any).getActiveStreamPaths;

const now = Date.now();
const ticket: PublishTicketRecord = {
  ticketId: "ticket-1",
  recordingSessionId: "session-1",
  repositoryId: "repo-1",
  userId: "user-1",
  streamPath: "live/repo-name/session-1",
  issuedAt: now,
  status: "active",
};

beforeEach(() => {
  fakeRedis.clear();

  fakePrisma.recordingSession.findUnique = async () => null;
  fakePrisma.recordingSession.update = async () => null;
  fakePrisma.recordingSession.updateMany = async () => ({ count: 0 });
  fakePrisma.recordingSegment.count = async () => 0;
  fakePrisma.recordingSegment.findFirst = async () => null;
  fakePrisma.recordingSegment.aggregate = async () => ({ _max: { sequence: null } });
  fakePrisma.recordingSegment.upsert = async () => null;
  fakePrisma.recordingSegment.create = async () => null;
  fakePrisma.recordingSegment.update = async () => null;

  recordingSessionService.getLiveCacheByRecordingSessionId = originalGetLiveCacheByRecordingSessionId;
  recordingSessionService.tryEnqueueFinalize = originalTryEnqueueFinalize;
  streamOwnershipService.validatePublishTicket = originalValidatePublishTicket;
  streamOwnershipService.consumePublishTicket = originalConsumePublishTicket;
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
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: existingReadyAt,
  };
  const updateCalls: Array<unknown> = [];
  let consumeCalled = false;

  fakePrisma.recordingSession.findUnique = async () => session;
  fakePrisma.recordingSession.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  streamOwnershipService.validatePublishTicket = async () => ({
    ok: true,
    ticket,
    ticketId: ticket.ticketId,
  });
  streamOwnershipService.consumePublishTicket = async () => {
    consumeCalled = true;
    return {
      ok: true,
      ticket: {
        ...ticket,
        status: "consumed",
      },
    };
  };

  await recordingSessionService.handleStreamReady({
    path: "live/repo-name/session-1",
    query: "ticket=ticket-1",
    source_id: "new-source",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(consumeCalled, false);
  assert.equal(fakeRedis.has("stream:source:new-source"), false);
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
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
  };
  const updateCalls: Array<unknown> = [];

  fakePrisma.recordingSession.findUnique = async () => session;
  fakePrisma.recordingSession.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  recordingSessionService.getLiveCacheByRecordingSessionId = async () => null;
  streamOwnershipService.validatePublishTicket = async () => ({
    ok: true,
    ticket,
    ticketId: ticket.ticketId,
  });
  streamOwnershipService.consumePublishTicket = async () => ({
    ok: false,
    reason: "ticket-status-consumed",
    ticketId: ticket.ticketId,
  });

  await recordingSessionService.handleStreamReady({
    path: "live/repo-name/session-1",
    query: "ticket=ticket-1",
    source_id: "new-source",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(fakeRedis.has("stream:recording:session-1"), false);
  assert.equal(fakeRedis.has("stream:source:new-source"), false);
});

test("handleStreamReady accepts an explicit ticket field when hook query is empty", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
  };
  const updateCalls: Array<unknown> = [];
  const validationQueries: Array<string | undefined> = [];
  const consumeQueries: Array<string | undefined> = [];

  fakePrisma.recordingSession.findUnique = async () => session;
  fakePrisma.recordingSession.update = async (args: unknown) => {
    updateCalls.push(args);
    return session;
  };

  recordingSessionService.getLiveCacheByRecordingSessionId = async () => null;
  streamOwnershipService.validatePublishTicket = async (_path: string, query?: string) => {
    validationQueries.push(query);
    return {
      ok: true,
      ticket,
      ticketId: ticket.ticketId,
    };
  };
  streamOwnershipService.consumePublishTicket = async (_path: string, query?: string) => {
    consumeQueries.push(query);
    return {
      ok: true,
      ticket: {
        ...ticket,
        status: "consumed",
      },
    };
  };

  await recordingSessionService.handleStreamReady({
    path: "live/repo-name/session-1",
    query: "",
    ticket: "ticket-1",
    source_id: "new-source",
    source_type: "rtmp",
  });

  assert.deepEqual(validationQueries, ["ticket=ticket-1"]);
  assert.deepEqual(consumeQueries, ["ticket=ticket-1"]);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), ["session-1"]);
  assert.equal(fakeRedis.has("stream:source:new-source"), false);
  assert.deepEqual(fakeRedis.getJson<RecordingSessionLiveCache>("stream:recording:session-1"), {
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    status: "STREAMING",
  });
  assert.equal(fakeRedis.getTtlSeconds("stream:recording:session-1"), 24 * 60 * 60);
});

test("handleStreamNotReady finalizes the session resolved from stream path", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findUnique = async () => session;
  fakePrisma.recordingSession.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  recordingSessionService.tryEnqueueFinalize = async () => true;

  await fakeRedis.sadd("stream:active:sessions", "session-1");
  fakeRedis.setJson("stream:recording:session-1", {
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  await recordingSessionService.handleStreamNotReady({
    path: "live/repo-name/session-1",
    source_id: "source-1",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.FINALIZING);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
  assert.equal(await fakeRedis.get("stream:recording:session-1"), null);
});

test("handleSegmentCreate stores segment ownership mapping from stream path", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
  });
  fakePrisma.recordingSegment.aggregate = async () => ({ _max: { sequence: 3 } });
  fakePrisma.recordingSegment.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return null;
  };

  await recordingSessionService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    source_id: "source-1",
    segment_path: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(
    fakeRedis.getJson("segment:/data/raw/live/repo-name/session-1/segment-0001.mp4"),
    {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      segmentPath: "/data/raw/live/repo-name/session-1/segment-0001.mp4",
    },
  );
});

test("handleSegmentCreate works when source_id is omitted", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findUnique = async () => ({
    id: "session-1",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
  });
  fakePrisma.recordingSegment.aggregate = async () => ({ _max: { sequence: 1 } });
  fakePrisma.recordingSegment.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return null;
  };

  await recordingSessionService.handleSegmentCreate({
    path: "live/repo-name/session-1",
    source_id: undefined,
    segment_path: "/data/raw/live/repo-name/session-1/segment-0002.mp4",
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(
    fakeRedis.getJson("segment:/data/raw/live/repo-name/session-1/segment-0002.mp4"),
    {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      segmentPath: "/data/raw/live/repo-name/session-1/segment-0002.mp4",
    },
  );
});

test("reconcile keeps a recent pending registration until timeout", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: new Date(Date.now() - 20_000),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  (recordingSessionService as any).getActiveStreamPaths = async () => null;

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 0);
});

test("reconcile uses the refreshed pending registration timestamp before aborting", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: new Date(Date.now() - 10 * 60_000),
    updatedAt: new Date(Date.now() - 60_000),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  (recordingSessionService as any).getActiveStreamPaths = async () => null;

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 0);
});

test("reconcile aborts an expired pending registration only when the row was not refreshed", async () => {
  const staleUpdatedAt = new Date(Date.now() - 10 * 60_000);
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    endReason: null,
  };
  const updateManyCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.updateMany = async (args: Record<string, unknown>) => {
    updateManyCalls.push(args);
    return { count: 1 };
  };

  (recordingSessionService as any).getActiveStreamPaths = async () => null;
  fakeRedis.setJson("stream:recording:session-1", {
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);

  await recordingSessionService.reconcileSessions();

  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual((updateManyCalls[0] as any).where, {
    id: "session-1",
    status: RecordingSessionStatus.PENDING,
    updatedAt: { lte: staleUpdatedAt },
  });
  assert.equal((updateManyCalls[0] as any).data.status, RecordingSessionStatus.ABORTED);
  assert.equal((updateManyCalls[0] as any).data.endReason, RecordingSessionEndReason.REGISTRATION_TIMEOUT);
  assert.equal(await fakeRedis.get("stream:recording:session-1"), null);
});

test("reconcile does not abort a pending registration that register refreshed concurrently", async () => {
  const staleUpdatedAt = new Date(Date.now() - 10 * 60_000);
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    readyAt: null,
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: staleUpdatedAt,
    updatedAt: staleUpdatedAt,
    endReason: null,
  };
  const updateManyCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.updateMany = async (args: Record<string, unknown>) => {
    updateManyCalls.push(args);
    return { count: 0 };
  };

  (recordingSessionService as any).getActiveStreamPaths = async () => null;

  await recordingSessionService.reconcileSessions();

  assert.equal(updateManyCalls.length, 1);
});

test("reconcile finalizes a broken streaming session when active path is missing", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name/session-1",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  await fakeRedis.sadd("stream:active:sessions", "session-1");
  fakeRedis.setJson("stream:recording:session-1", {
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "user-1",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  recordingSessionService.tryEnqueueFinalize = async () => true;
  (recordingSessionService as any).getActiveStreamPaths = async () => new Set<string>();

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.FINALIZING);
  assert.deepEqual(await fakeRedis.smembers("stream:active:sessions"), []);
  assert.equal(await fakeRedis.get("stream:recording:session-1"), null);
});

test("tryEnqueueFinalize aborts an empty USER_STOP session instead of failing", async () => {
  const updateCalls: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];

  fakePrisma.recordingSession.findUnique = async () => ({
    id: "session-empty",
    repositoryId: "repo-1",
    streamPath: "live/repo-name/session-empty",
    status: RecordingSessionStatus.FINALIZING,
    endReason: RecordingSessionEndReason.USER_STOP,
    createdAt: new Date(Date.now() - 60_000),
    readyAt: new Date(Date.now() - 55_000),
    stopRequestedAt: new Date(Date.now() - 50_000),
    notReadyAt: new Date(Date.now() - 40_000),
    finalizedAt: null,
    video: null,
  });
  fakePrisma.recordingSession.update = async (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    updateCalls.push(args);
    return args;
  };
  fakePrisma.recordingSegment.count = async (args?: { where?: { status?: RecordingSegmentStatus } }) => {
    if (args?.where?.status === RecordingSegmentStatus.WRITING) {
      return 0;
    }
    if (args?.where?.status === RecordingSegmentStatus.COMPLETED) {
      return 0;
    }
    return 0;
  };

  const enqueued = await recordingSessionService.tryEnqueueFinalize("session-empty");

  assert.equal(enqueued, false);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.where.id, "session-empty");
  assert.equal(updateCalls[0]?.data.status, RecordingSessionStatus.ABORTED);
  assert.equal(updateCalls[0]?.data.endReason, RecordingSessionEndReason.USER_STOP);
});
