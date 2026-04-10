import assert from "node:assert/strict";
import { RecordingSessionEndReason, RecordingSegmentStatus, RecordingSessionStatus } from "@prisma/client";
import { beforeEach, test } from "node:test";

import type {
  PublishTicketRecord,
  RecordingSessionLiveCache,
  StreamConnectionMetadata,
  StreamOwnerLease,
} from "../src/types/stream";
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
const originalRefreshConnectionLease = streamOwnershipService.refreshConnectionLease;
const originalReleaseConnectionLease = streamOwnershipService.releaseConnectionLease;
const originalGetCurrentOwnerForRepository = streamOwnershipService.getCurrentOwnerForRepository;
const originalListConnections = streamOwnershipService.listConnections;
const originalGetActiveRepositoryNames = (recordingSessionService as any).getActiveRepositoryNames;

const now = Date.now();
const ticket: PublishTicketRecord = {
  ticketId: "ticket-1",
  streamId: "repository:repo-1",
  recordingSessionId: "session-1",
  connectionId: "conn-2",
  generation: 2,
  repositoryId: "repo-1",
  repositoryName: "repo-name",
  userId: "user-1",
  streamPath: "live/repo-name",
  issuedAt: now,
  expiresAt: now + 60_000,
  status: "active",
};

const claimedOwner: StreamOwnerLease = {
  streamId: ticket.streamId,
  recordingSessionId: ticket.recordingSessionId,
  connectionId: ticket.connectionId,
  generation: ticket.generation,
  status: "claimed",
  repositoryId: ticket.repositoryId,
  repositoryName: ticket.repositoryName,
  userId: ticket.userId,
  streamPath: ticket.streamPath,
  lastHeartbeatAt: now,
  leaseExpiresAt: now + 60_000,
};

const claimedConnection: StreamConnectionMetadata = {
  streamId: ticket.streamId,
  recordingSessionId: ticket.recordingSessionId,
  connectionId: ticket.connectionId,
  generation: ticket.generation,
  repositoryId: ticket.repositoryId,
  repositoryName: ticket.repositoryName,
  userId: ticket.userId,
  streamPath: ticket.streamPath,
  status: "claimed",
  createdAt: now,
  lastHeartbeatAt: now,
  leaseExpiresAt: now + 60_000,
};

beforeEach(() => {
  fakeRedis.clear();

  fakePrisma.recordingSession.findUnique = async () => null;
  fakePrisma.recordingSession.update = async () => null;
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
  streamOwnershipService.refreshConnectionLease = originalRefreshConnectionLease;
  streamOwnershipService.releaseConnectionLease = originalReleaseConnectionLease;
  streamOwnershipService.getCurrentOwnerForRepository = originalGetCurrentOwnerForRepository;
  streamOwnershipService.listConnections = originalListConnections;
  (recordingSessionService as any).getActiveRepositoryNames = originalGetActiveRepositoryNames;
});

test("handleStreamReady accepts same-session reconnects and replaces the source pointer", async () => {
  const existingReadyAt = new Date("2026-04-09T00:00:00.000Z");
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    sourceId: "old-source",
    sourceType: "rtmp",
    readyAt: existingReadyAt,
  };
  const updateCalls: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];

  fakePrisma.recordingSession.findUnique = async () => session;
  fakePrisma.recordingSession.update = async (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    updateCalls.push(args);
    return {
      ...session,
      ...args.data,
    };
  };

  const existingLiveCache: RecordingSessionLiveCache = {
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    ownerId: "owner-1",
    userId: "user-1",
    targetDirectory: "/data/raw",
    status: "STREAMING",
    sourceId: "old-source",
    sourceType: "rtmp",
    publishTicketIssuedAt: "2026-04-09T00:00:05.000Z",
    readyAt: existingReadyAt.toISOString(),
  };

  recordingSessionService.getLiveCacheByRecordingSessionId = async () => existingLiveCache;
  streamOwnershipService.validatePublishTicket = async () => ({
    ok: true,
    ticket,
    ticketId: ticket.ticketId,
    owner: claimedOwner,
    connection: claimedConnection,
  });
  streamOwnershipService.consumePublishTicket = async () => ({
    ok: true,
    ticket: {
      ...ticket,
      status: "consumed",
    },
  });
  streamOwnershipService.refreshConnectionLease = async () => ({
    outcome: "refreshed",
    owner: {
      ...claimedOwner,
      status: "publishing",
      sourceId: "new-source",
      sourceType: "rtmp",
      leaseExpiresAt: Date.now() + 30_000,
    },
    connection: {
      ...claimedConnection,
      status: "publishing",
      sourceId: "new-source",
      sourceType: "rtmp",
      leaseExpiresAt: Date.now() + 30_000,
    },
  });

  await fakeRedis.set("stream:source:old-source", "session-1");

  await recordingSessionService.handleStreamReady({
    path: "live/repo-name",
    query: "ticket=ticket-1",
    source_id: "new-source",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.status, RecordingSessionStatus.STREAMING);
  assert.equal(updateCalls[0]?.data.sourceId, "new-source");
  assert.equal(updateCalls[0]?.data.sourceType, "rtmp");
  assert.equal(Object.hasOwn(updateCalls[0]?.data ?? {}, "readyAt"), false);
  assert.equal(await fakeRedis.get("stream:source:old-source"), null);
  assert.deepEqual(
    fakeRedis.getJson("stream:source:new-source"),
    {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "new-source",
      sourceType: "rtmp",
    },
  );

  const storedLiveCache = fakeRedis.getJson<RecordingSessionLiveCache>("stream:recording:session-1");
  assert.ok(storedLiveCache);
  assert.equal(storedLiveCache?.sourceId, "new-source");
  assert.equal(storedLiveCache?.readyAt, existingReadyAt.toISOString());
});

test("handleStreamReady leaves DB and Redis untouched when owner publishing refresh is rejected", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    sourceId: null,
    sourceType: null,
    readyAt: null,
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
    owner: claimedOwner,
    connection: claimedConnection,
  });
  streamOwnershipService.consumePublishTicket = async () => ({
    ok: true,
    ticket: {
      ...ticket,
      status: "consumed",
    },
  });
  streamOwnershipService.refreshConnectionLease = async () => ({
    outcome: "rejected",
    reason: "generation-mismatch",
  });

  await recordingSessionService.handleStreamReady({
    path: "live/repo-name",
    query: "ticket=ticket-1",
    source_id: "new-source",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 0);
  assert.equal(fakeRedis.has("stream:recording:session-1"), false);
  assert.equal(fakeRedis.has("stream:source:new-source"), false);
});

test("handleStreamNotReady finalizes only the authoritative source mapping", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    sourceId: "source-1",
    sourceType: "rtmp",
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

  streamOwnershipService.releaseConnectionLease = async () => ({
    outcome: "released",
    releasedOwner: true,
    releasedConnection: true,
  });

  recordingSessionService.tryEnqueueFinalize = async () => true;

  await fakeRedis.set(
    "stream:source:source-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      sourceType: "rtmp",
    }),
  );
  await fakeRedis.set("stream:repo:repo-1", "session-1");
  await fakeRedis.set("stream:path:repo-name", "session-1");

  await recordingSessionService.handleStreamNotReady({
    path: "live/repo-name",
    source_id: "source-1",
    source_type: "rtmp",
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.FINALIZING);
  assert.equal(await fakeRedis.get("stream:source:source-1"), null);
});

test("handleSegmentCreate stores authoritative segment ownership mapping", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSegment.aggregate = async () => ({ _max: { sequence: 3 } });
  fakePrisma.recordingSegment.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return null;
  };

  await fakeRedis.set(
    "stream:source:source-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      sourceType: "rtmp",
    }),
  );

  await recordingSessionService.handleSegmentCreate({
    path: "live/repo-name",
    source_id: "source-1",
    segment_path: "/data/raw/live/repo-name/segment-0001.mp4",
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(
    fakeRedis.getJson("segment:/data/raw/live/repo-name/segment-0001.mp4"),
    {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      segmentPath: "/data/raw/live/repo-name/segment-0001.mp4",
    },
  );
});

test("handleSegmentCreate falls back to the live path pointer when source_id is omitted", async () => {
  const upsertCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSegment.aggregate = async () => ({ _max: { sequence: 1 } });
  fakePrisma.recordingSegment.upsert = async (args: Record<string, unknown>) => {
    upsertCalls.push(args);
    return null;
  };

  await fakeRedis.set(
    "stream:recording:session-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      repositoryName: "repo-name",
      ownerId: "owner-1",
      userId: "user-1",
      targetDirectory: "/data/raw",
      status: "STREAMING",
      sourceId: "source-1",
      sourceType: "rtmp",
    } satisfies RecordingSessionLiveCache),
  );
  await fakeRedis.set("stream:path:repo-name", "session-1");
  await fakeRedis.set(
    "stream:source:source-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      sourceType: "rtmp",
    }),
  );

  await recordingSessionService.handleSegmentCreate({
    path: "live/repo-name",
    source_id: undefined,
    segment_path: "/data/raw/live/repo-name/segment-0002.mp4",
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(
    fakeRedis.getJson("segment:/data/raw/live/repo-name/segment-0002.mp4"),
    {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      segmentPath: "/data/raw/live/repo-name/segment-0002.mp4",
    },
  );
});

test("reconcile keeps a pending claimed owner alive until the initial lease actually expires", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data/raw",
    sourceId: null,
    sourceType: null,
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

  await fakeRedis.set(
    "stream:recording:session-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      repositoryName: "repo-name",
      ownerId: "owner-1",
      userId: "user-1",
      targetDirectory: "/data/raw",
      status: "PENDING",
      publishTicketIssuedAt: new Date(Date.now() - 20_000).toISOString(),
    } satisfies RecordingSessionLiveCache),
  );

  streamOwnershipService.getCurrentOwnerForRepository = async () => ({
    ...claimedOwner,
    status: "claimed",
    leaseExpiresAt: Date.now() + 40_000,
    lastHeartbeatAt: Date.now() - 20_000,
  });
  streamOwnershipService.listConnections = async () => [];
  (recordingSessionService as any).getActiveRepositoryNames = async () => null;

  await recordingSessionService.reconcileSessions();

  assert.equal(updateCalls.length, 0);
});

test("reconcile releases the current owner before finalizing a broken streaming session", async () => {
  const session = {
    id: "session-1",
    repositoryId: "repo-1",
    ownerId: "owner-1",
    userId: "user-1",
    deviceType: null,
    streamPath: "live/repo-name",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data/raw",
    sourceId: "source-1",
    sourceType: "rtmp",
    readyAt: new Date("2026-04-09T00:00:00.000Z"),
    stopRequestedAt: null,
    notReadyAt: null,
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    endReason: null,
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  const releaseCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [session];
  fakePrisma.recordingSession.update = async (args: { data: Record<string, unknown> }) => {
    updateCalls.push(args.data);
    return {
      ...session,
      ...args.data,
    };
  };

  await fakeRedis.set("stream:repo:repo-1", "session-1");
  await fakeRedis.set("stream:path:repo-name", "session-1");
  await fakeRedis.set(
    "stream:recording:session-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      repositoryName: "repo-name",
      ownerId: "owner-1",
      userId: "user-1",
      targetDirectory: "/data/raw",
      status: "STREAMING",
      sourceId: "source-1",
      sourceType: "rtmp",
    } satisfies RecordingSessionLiveCache),
  );
  await fakeRedis.set(
    "stream:source:source-1",
    JSON.stringify({
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      connectionId: "conn-2",
      generation: 2,
      sourceId: "source-1",
      sourceType: "rtmp",
    }),
  );

  streamOwnershipService.getCurrentOwnerForRepository = async () => ({
    ...claimedOwner,
    status: "publishing",
    sourceId: "source-1",
    sourceType: "rtmp",
    leaseExpiresAt: Date.now() + 30_000,
    lastHeartbeatAt: Date.now(),
  });
  streamOwnershipService.releaseConnectionLease = async (args: {
    repositoryId: string;
    recordingSessionId: string;
    connectionId: string;
    generation: number;
  }) => {
    releaseCalls.push(args);
    return {
      outcome: "released",
      releasedOwner: true,
      releasedConnection: true,
    };
  };
  streamOwnershipService.listConnections = async () => [];
  recordingSessionService.tryEnqueueFinalize = async () => true;
  (recordingSessionService as any).getActiveRepositoryNames = async () => new Set<string>();

  await recordingSessionService.reconcileSessions();

  assert.equal(releaseCalls.length, 1);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.status, RecordingSessionStatus.FINALIZING);
});

test("tryEnqueueFinalize aborts an empty USER_STOP session instead of failing", async () => {
  const updateCalls: Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }> = [];

  fakePrisma.recordingSession.findUnique = async () => ({
    id: "session-empty",
    repositoryId: "repo-1",
    streamPath: "live/repo-name",
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
