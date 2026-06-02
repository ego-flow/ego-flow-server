import assert from "node:assert/strict";
import { RecordingSessionEndReason, RecordingSessionIngestType, RecordingSessionStatus } from "@prisma/client";
import { after, beforeEach, test } from "node:test";

import { FakeRedis } from "./helpers/fake-redis";
import type { RecordingSessionLiveCache } from "../src/types/stream";

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
  recordingSession: {
    create: async (_args?: unknown) => null,
    findMany: async (_args?: unknown) => [],
    findUnique: async (_args?: unknown) => null,
    update: async (_args?: unknown) => null,
    updateMany: async (_args?: unknown) => ({ count: 0 }),
  },
};

(globalThis as any).__egoflowRedis = fakeRedis;
(globalThis as any).__egoflowPrisma = fakePrisma;

const { streamService } =
  require("../src/services/stream.service") as typeof import("../src/services/stream.service");
const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { Forbidden, NotFound } = require("../src/lib/errors") as typeof import("../src/lib/errors");

const originalAssertRepositoryAccess = repositoryService.assertRepositoryAccess;
const originalListAccessibleRepositoryIds = repositoryService.listAccessibleRepositoryIds;

const repository = {
  id: "566fdab1-771a-42f9-a4eb-2f1c04859874",
  name: "test2",
  ownerId: "admin",
  visibility: "public" as const,
  description: null,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
};

const createSessionFromArgs = (args: { data: Record<string, any> }) => ({
  id: args.data.id,
  repositoryId: args.data.repositoryId,
  ownerId: args.data.ownerId,
  userId: args.data.userId,
  deviceType: args.data.deviceType,
  ingestType: args.data.ingestType,
  streamPath: args.data.streamPath,
  status: args.data.status,
  targetDirectory: args.data.targetDirectory,
  readyAt: null,
  closedAt: null,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
});

beforeEach(() => {
  fakeRedis.clear();

  fakePrisma.recordingSession.create = async (args: { data: Record<string, any> }) =>
    createSessionFromArgs(args);
  fakePrisma.recordingSession.findMany = async () => [];
  fakePrisma.recordingSession.findUnique = async () => null;
  fakePrisma.recordingSession.update = async () => null;
  fakePrisma.recordingSession.updateMany = async () => ({ count: 0 });

  repositoryService.assertRepositoryAccess = async () => ({
    repository,
    effectiveRole: "maintain",
    isSystemAdmin: false,
  });
  repositoryService.listAccessibleRepositoryIds = originalListAccessibleRepositoryIds;
});

test("registerSession creates a unique MediaMTX path and caches pending metadata", async () => {
  const createCalls: Array<{ data: Record<string, any> }> = [];
  fakePrisma.recordingSession.create = async (args: { data: Record<string, any> }) => {
    createCalls.push(args);
    return createSessionFromArgs(args);
  };

  const response = await streamService.registerSession("maintainer-1", "user", {
    repositoryId: repository.id,
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
  });

  assert.equal(createCalls.length, 1);
  assert.equal(response.recordingSessionId, createCalls[0]!.data.id);
  assert.equal(createCalls[0]!.data.streamPath, `live/test2/${response.recordingSessionId}`);

  const cache = fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${response.recordingSessionId}`);
  assert.deepEqual(cache, {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    deviceType: "phone_android",
    status: "PENDING",
  });
  assert.equal(fakeRedis.getTtlSeconds(`stream:recording:${response.recordingSessionId}`), 300);
});

test("registerSession reuses a non-expired pending session for the same user repository and device", async () => {
  const existingSession = {
    id: "11111111-1111-4111-8111-111111111111",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
  };
  let createCalled = false;
  const updateCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

  fakePrisma.recordingSession.findMany = async () => [existingSession];
  fakePrisma.recordingSession.create = async (args: { data: Record<string, any> }) => {
    createCalled = true;
    return createSessionFromArgs(args);
  };
  fakePrisma.recordingSession.update = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    updateCalls.push(args);
    return {
      ...existingSession,
      updatedAt: args.data.updatedAt as Date,
    };
  };

  const response = await streamService.registerSession("maintainer-1", "user", {
    repositoryId: repository.id,
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
  });

  assert.equal(createCalled, false);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]!.where.id, existingSession.id);
  assert.equal(updateCalls[0]!.data.status, RecordingSessionStatus.PENDING);
  assert.ok(updateCalls[0]!.data.updatedAt instanceof Date);
  assert.equal(response.recordingSessionId, existingSession.id);
  assert.deepEqual(fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${existingSession.id}`), {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    deviceType: "phone_android",
    status: "PENDING",
  });
  assert.equal(fakeRedis.getTtlSeconds(`stream:recording:${existingSession.id}`), 300);
});

test("registerSession reuses pending sessions regardless of age and refreshes Redis cache", async () => {
  const stalePendingSession = {
    id: "22222222-2222-4222-8222-222222222222",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/22222222-2222-4222-8222-222222222222",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    createdAt: new Date(Date.now() - 6 * 60_000),
    updatedAt: new Date(Date.now() - 6 * 60_000),
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [stalePendingSession];
  fakePrisma.recordingSession.update = async (args: Record<string, unknown>) => {
    updateCalls.push(args);
    return {
      ...stalePendingSession,
      ...((args as any).data as Record<string, unknown>),
    };
  };
  fakePrisma.recordingSession.updateMany = async (args: Record<string, unknown>) => {
    updateManyCalls.push(args);
    return { count: 1 };
  };

  const response = await streamService.registerSession("maintainer-1", "user", {
    repositoryId: repository.id,
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
  });

  assert.equal(updateCalls.length, 1);
  assert.equal((updateCalls[0] as any).where.id, stalePendingSession.id);
  assert.equal((updateCalls[0] as any).data.status, RecordingSessionStatus.PENDING);
  assert.ok((updateCalls[0] as any).data.updatedAt instanceof Date);
  assert.equal(updateManyCalls.length, 0);
  assert.equal(response.recordingSessionId, stalePendingSession.id);
  assert.equal(fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${stalePendingSession.id}`)?.status, "PENDING");
});

test("registerSession completes pending sessions when maintain access is forbidden", async () => {
  const existingSession = {
    id: "33333333-3333-4333-8333-333333333333",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/33333333-3333-4333-8333-333333333333",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
  };
  const findManyCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];

  repositoryService.assertRepositoryAccess = async () => {
    throw Forbidden("You do not have permission for this repository action.");
  };
  fakePrisma.recordingSession.findMany = async (args: Record<string, unknown>) => {
    findManyCalls.push(args);
    return [existingSession];
  };
  fakePrisma.recordingSession.updateMany = async (args: Record<string, unknown>) => {
    updateManyCalls.push(args);
    return { count: 1 };
  };
  fakeRedis.setJson(`stream:recording:${existingSession.id}`, {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);

  await assert.rejects(
    () =>
      streamService.registerSession("maintainer-1", "user", {
        repositoryId: repository.id,
        deviceType: "phone_android",
        ingestType: "MEDIAMTX",
      }),
    (error: any) => error?.code === "FORBIDDEN",
  );

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual((findManyCalls[0] as any).where, {
    repositoryId: repository.id,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: RecordingSessionStatus.PENDING,
  });
  assert.equal(updateManyCalls.length, 1);
  assert.deepEqual((updateManyCalls[0] as any).where, {
    id: existingSession.id,
    status: RecordingSessionStatus.PENDING,
  });
  assert.equal((updateManyCalls[0] as any).data.status, RecordingSessionStatus.CLOSED);
  assert.equal((updateManyCalls[0] as any).data.endReason, RecordingSessionEndReason.ACCESS_FORBIDDEN);
  assert.equal(await fakeRedis.get(`stream:recording:${existingSession.id}`), null);
});

test("registerSession completes pending sessions when repository is missing", async () => {
  const existingSession = {
    id: "33333333-3333-4333-8333-333333333333",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/33333333-3333-4333-8333-333333333333",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 60_000),
  };
  const findManyCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];

  repositoryService.assertRepositoryAccess = async () => {
    throw NotFound("Repository not found.");
  };
  fakePrisma.recordingSession.findMany = async (args: Record<string, unknown>) => {
    findManyCalls.push(args);
    return [existingSession];
  };
  fakePrisma.recordingSession.updateMany = async (args: Record<string, unknown>) => {
    updateManyCalls.push(args);
    return { count: 1 };
  };
  fakeRedis.setJson(`stream:recording:${existingSession.id}`, {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);

  await assert.rejects(
    () =>
      streamService.registerSession("maintainer-1", "user", {
        repositoryId: repository.id,
        deviceType: "phone_android",
        ingestType: "MEDIAMTX",
      }),
    (error: any) => error?.code === "NOT_FOUND",
  );

  assert.equal(findManyCalls.length, 1);
  assert.deepEqual((findManyCalls[0] as any).where, {
    repositoryId: repository.id,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: RecordingSessionStatus.PENDING,
  });
  assert.equal(updateManyCalls.length, 1);
  assert.equal((updateManyCalls[0] as any).data.status, RecordingSessionStatus.CLOSED);
  assert.equal((updateManyCalls[0] as any).data.endReason, RecordingSessionEndReason.REPOSITORY_DELETED);
  assert.equal(await fakeRedis.get(`stream:recording:${existingSession.id}`), null);
});

test("issuePublishTicket skips repository recheck and stores only ticket metadata", async () => {
  const pendingSession = {
    id: "44444444-4444-4444-8444-444444444444",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/44444444-4444-4444-8444-444444444444",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    readyAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 10 * 60_000),
    updatedAt: new Date(Date.now() - 10 * 60_000),
  };
  let repositoryAccessChecked = false;

  fakePrisma.recordingSession.findUnique = async () => pendingSession;
  repositoryService.assertRepositoryAccess = async () => {
    repositoryAccessChecked = true;
    throw Forbidden("Repository access should not be rechecked.");
  };
  fakeRedis.setJson(`stream:recording:${pendingSession.id}`, {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);

  const response = await streamService.issuePublishTicket("maintainer-1", "user", pendingSession.id);

  assert.equal(repositoryAccessChecked, false);
  assert.equal(response.stream_path, pendingSession.streamPath);
  assert.ok(response.publish_ticket.startsWith("t_"));
  assert.deepEqual(Object.keys(response).sort(), ["publish_ticket", "stream_path"]);
  assert.equal(Object.hasOwn(response, "recording_session_id"), false);
  assert.equal(Object.hasOwn(response, "repository_id"), false);
  assert.equal(Object.hasOwn(response, "repository_name"), false);
  assert.equal(Object.hasOwn(response, "publish_ticket_expires_at"), false);
  assert.equal(Object.hasOwn(response, "rtmp_publish_base_url"), false);
  assert.equal(Object.hasOwn(response, "rtmp_publish_host"), false);
  assert.equal(Object.hasOwn(response, "whip_publish_url"), false);

  const ticket = fakeRedis.getJson<Record<string, unknown>>(`stream:ticket:${response.publish_ticket}`);
  assert.equal(ticket?.recordingSessionId, pendingSession.id);
  assert.equal(ticket?.repositoryId, repository.id);
  assert.equal(ticket?.userId, "maintainer-1");
  assert.equal(ticket?.ingestType, "MEDIAMTX");
  assert.equal(ticket?.streamPath, pendingSession.streamPath);
  assert.equal(ticket?.status, "active");
  assert.equal(Object.hasOwn(ticket ?? {}, "repositoryName"), false);
});

test("issuePublishTicket rejects a PENDING recording session without Redis registration cache", async () => {
  const pendingSession = {
    id: "44444444-4444-4444-8444-444444444444",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/44444444-4444-4444-8444-444444444444",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    readyAt: null,
    closedAt: null,
    createdAt: new Date(Date.now() - 10 * 60_000),
    updatedAt: new Date(Date.now() - 10 * 60_000),
  };

  fakePrisma.recordingSession.findUnique = async () => pendingSession;

  await assert.rejects(
    () => streamService.issuePublishTicket("maintainer-1", "user", pendingSession.id),
    (error: any) =>
      error?.statusCode === 412 &&
      error?.code === "PRECONDITION_FAILED" &&
      error?.message === "Recording session registration has expired. Please register again.",
  );

  const [_cursor, ticketKeys] = (await fakeRedis.scan("0", "MATCH", "stream:ticket:*")) as [string, string[]];
  assert.deepEqual(ticketKeys, []);
});

test("issuePublishTicket only allows PENDING recording sessions", async () => {
  const streamingSession = {
    id: "55555555-5555-4555-8555-555555555555",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: "live/test2/55555555-5555-4555-8555-555555555555",
    status: RecordingSessionStatus.STREAMING,
    targetDirectory: "/data",
    readyAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  fakePrisma.recordingSession.findUnique = async () => streamingSession;

  await assert.rejects(
    () => streamService.issuePublishTicket("maintainer-1", "user", streamingSession.id),
    (error: any) =>
      error?.code === "CONFLICT" &&
      error?.message === "Recording session is already in STREAMING state.",
  );

  const [_cursor, ticketKeys] = (await fakeRedis.scan("0", "MATCH", "stream:ticket:*")) as [string, string[]];
  assert.deepEqual(ticketKeys, []);
});

test("listLiveStreams reads active ids and live metadata from Redis", async () => {
  fakePrisma.recordingSession.findMany = async () => {
    throw new Error("listLiveStreams should not query recording_sessions");
  };
  repositoryService.listAccessibleRepositoryIds = async () => new Set([repository.id]);

  await fakeRedis.sadd("stream:active:sessions", "session-1", "session-pending", "session-hidden");
  fakeRedis.setJson("stream:recording:session-1", {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);
  fakeRedis.setJson("stream:recording:session-pending", {
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    ingestType: "MEDIAMTX",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);
  fakeRedis.setJson("stream:recording:session-hidden", {
    repositoryId: "99999999-9999-4999-8999-999999999999",
    repositoryName: "hidden",
    userId: "other-user",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  const streams = await streamService.listLiveStreams("maintainer-1", "user");

  assert.deepEqual(streams, [
    {
      stream_id: "session-1",
      repository_id: repository.id,
      repository_name: repository.name,
      user_id: "maintainer-1",
      device_type: "phone_android",
      ingest_type: "MEDIAMTX",
      status: "live",
      playback_available: true,
      hls_path: "/hls/live/test2/session-1/index.m3u8",
      bytes_received: null,
      last_sequence: null,
      last_chunk_at: null,
    },
  ]);
});

after(() => {
  repositoryService.assertRepositoryAccess = originalAssertRepositoryAccess;
  repositoryService.listAccessibleRepositoryIds = originalListAccessibleRepositoryIds;
});
