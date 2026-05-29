import assert from "node:assert/strict";
import { RecordingSessionStatus } from "@prisma/client";
import { after, beforeEach, test } from "node:test";

import type { RecordingSessionLiveCache } from "../src/types/stream";
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
  streamPath: args.data.streamPath,
  status: args.data.status,
  targetDirectory: args.data.targetDirectory,
  sourceId: null,
  sourceType: null,
  stopRequestedAt: null,
  readyAt: null,
  notReadyAt: null,
  finalizedAt: null,
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

test("registerSession creates a unique MediaMTX path and only stores recording cache", async () => {
  const createCalls: Array<{ data: Record<string, any> }> = [];
  fakePrisma.recordingSession.create = async (args: { data: Record<string, any> }) => {
    createCalls.push(args);
    return createSessionFromArgs(args);
  };

  const response = await streamService.registerSession("maintainer-1", "user", {
    repositoryId: repository.id,
    deviceType: "phone_android",
  });

  assert.equal(createCalls.length, 1);
  assert.equal(response.recordingSessionId, createCalls[0]!.data.id);
  assert.equal(createCalls[0]!.data.streamPath, `live/test2/${response.recordingSessionId}`);

  const stored = fakeRedis.getJson<RecordingSessionLiveCache>(
    `stream:recording:${response.recordingSessionId}`,
  );
  assert.deepEqual(stored, {
    recordingSessionId: response.recordingSessionId,
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: "PENDING",
  });
  assert.equal(await fakeRedis.get(`stream:repo:${repository.id}`), null);
  assert.equal(await fakeRedis.get("stream:path:test2"), null);
});

test("registerSession reuses a non-expired pending session for the same user repository and device", async () => {
  const existingSession = {
    id: "11111111-1111-4111-8111-111111111111",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
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
  });

  assert.equal(createCalled, false);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]!.where.id, existingSession.id);
  assert.equal(updateCalls[0]!.data.status, RecordingSessionStatus.PENDING);
  assert.ok(updateCalls[0]!.data.updatedAt instanceof Date);
  assert.equal(response.recordingSessionId, existingSession.id);
  assert.deepEqual(fakeRedis.getJson<RecordingSessionLiveCache>(`stream:recording:${existingSession.id}`), {
    recordingSessionId: existingSession.id,
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: "PENDING",
  });
  assert.equal(await fakeRedis.get(`stream:repo:${repository.id}`), null);
  assert.equal(await fakeRedis.get("stream:path:test2"), null);
});

test("registerSession reuses pending sessions regardless of age and leaves cleanup to reconcile", async () => {
  const expiredSession = {
    id: "22222222-2222-4222-8222-222222222222",
    repositoryId: repository.id,
    ownerId: repository.ownerId,
    userId: "maintainer-1",
    deviceType: "phone_android",
    streamPath: "live/test2/22222222-2222-4222-8222-222222222222",
    status: RecordingSessionStatus.PENDING,
    targetDirectory: "/data",
    createdAt: new Date(Date.now() - 6 * 60_000),
    updatedAt: new Date(Date.now() - 6 * 60_000),
  };
  const updateCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];

  fakePrisma.recordingSession.findMany = async () => [expiredSession];
  fakePrisma.recordingSession.update = async (args: Record<string, unknown>) => {
    updateCalls.push(args);
    return {
      ...expiredSession,
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
  });

  assert.equal(updateCalls.length, 1);
  assert.equal((updateCalls[0] as any).where.id, expiredSession.id);
  assert.equal((updateCalls[0] as any).data.status, RecordingSessionStatus.PENDING);
  assert.ok((updateCalls[0] as any).data.updatedAt instanceof Date);
  assert.equal(updateManyCalls.length, 0);
  assert.equal(response.recordingSessionId, expiredSession.id);
});

test("listLiveStreams reads active stream metadata from Redis only", async () => {
  fakePrisma.recordingSession.findMany = async () => {
    throw new Error("listLiveStreams should not query recordingSession.");
  };
  repositoryService.listAccessibleRepositoryIds = async () => new Set([repository.id]);

  await fakeRedis.sadd("stream:active:sessions", "session-1", "session-pending", "session-hidden");
  await fakeRedis.setJson("stream:recording:session-1", {
    recordingSessionId: "session-1",
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: "STREAMING",
    sourceId: "source-1",
  } satisfies RecordingSessionLiveCache);
  await fakeRedis.setJson("stream:recording:session-pending", {
    recordingSessionId: "session-pending",
    repositoryId: repository.id,
    repositoryName: repository.name,
    userId: "maintainer-1",
    deviceType: "phone_android",
    status: "PENDING",
  } satisfies RecordingSessionLiveCache);
  await fakeRedis.setJson("stream:recording:session-hidden", {
    recordingSessionId: "session-hidden",
    repositoryId: "99999999-9999-4999-8999-999999999999",
    repositoryName: "hidden",
    userId: "other-user",
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
      status: "live",
      hls_path: "/hls/live/test2/index.m3u8",
      whep_path: "/live/test2/whep",
    },
  ]);
});

after(() => {
  repositoryService.assertRepositoryAccess = originalAssertRepositoryAccess;
  repositoryService.listAccessibleRepositoryIds = originalListAccessibleRepositoryIds;
});
