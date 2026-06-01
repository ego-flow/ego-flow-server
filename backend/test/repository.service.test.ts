import assert from "node:assert/strict";
import { RecordingSegmentStatus, RecordingSessionStatus } from "@prisma/client";
import { beforeEach, test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const repository = {
  id: "566fdab1-771a-42f9-a4eb-2f1c04859874",
  name: "test2",
  ownerId: "admin",
  visibility: "public",
  description: null,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
};

const transactionOperations: unknown[] = [];
const operationCalls: Array<{ model: string; method: string; args?: unknown }> = [];

const fakePrisma: any = {
  repository: {
    findUnique: async () => repository,
    delete: (args: unknown) => {
      operationCalls.push({ model: "repository", method: "delete", args });
      return { model: "repository", method: "delete" };
    },
  },
  repoMember: {
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "repoMember", method: "deleteMany", args });
      return { model: "repoMember", method: "deleteMany" };
    },
  },
  video: {
    findMany: async () => [],
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "video", method: "deleteMany", args });
      return { model: "video", method: "deleteMany" };
    },
  },
  recordingSession: {
    findFirst: async () => null,
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "recordingSession", method: "deleteMany", args });
      return { model: "recordingSession", method: "deleteMany" };
    },
  },
  recordingSegment: {
    findFirst: async () => null,
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "recordingSegment", method: "deleteMany", args });
      return { model: "recordingSegment", method: "deleteMany" };
    },
  },
  $transaction: async (operations: unknown[]) => {
    transactionOperations.push(...operations);
    return operations;
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");

beforeEach(() => {
  transactionOperations.length = 0;
  operationCalls.length = 0;
  fakePrisma.repository.findUnique = async () => repository;
  fakePrisma.video.findMany = async () => [];
  fakePrisma.recordingSession.findFirst = async () => null;
  fakePrisma.recordingSegment.findFirst = async () => null;
});

test("deleteRepository rejects an active streaming session", async () => {
  const findFirstCalls: unknown[] = [];
  fakePrisma.recordingSession.findFirst = async (args: unknown) => {
    findFirstCalls.push(args);
    return { id: "streaming-session" };
  };

  await assert.rejects(
    () => repositoryService.deleteRepository("admin", "admin", repository.id),
    (error: any) =>
      error?.code === "CONFLICT" &&
      error?.message === "Repository cannot be modified while a stream is active.",
  );

  assert.deepEqual((findFirstCalls[0] as any).where, {
    repositoryId: repository.id,
    status: RecordingSessionStatus.STREAMING,
  });
  assert.equal(operationCalls.length, 0);
});

test("deleteRepository rejects an in-progress recording finalization", async () => {
  const segmentFindCalls: unknown[] = [];
  fakePrisma.recordingSegment.findFirst = async (args: unknown) => {
    segmentFindCalls.push(args);
    return { id: "segment-1" };
  };

  await assert.rejects(
    () => repositoryService.deleteRepository("admin", "admin", repository.id),
    (error: any) =>
      error?.code === "CONFLICT" &&
      error?.message === "Repository cannot be modified while recording finalization is in progress.",
  );

  assert.deepEqual((segmentFindCalls[0] as any).where, {
    status: {
      in: [
        RecordingSegmentStatus.WRITE_DONE,
        RecordingSegmentStatus.PROCESSING,
      ],
    },
    recordingSession: {
      repositoryId: repository.id,
    },
  });
  assert.equal(operationCalls.length, 0);
});

test("deleteRepository allows pending sessions and deletes repository-owned records", async () => {
  const result = await repositoryService.deleteRepository("admin", "admin", repository.id);

  assert.deepEqual(result, {
    id: repository.id,
    deleted: true,
  });
  assert.deepEqual(
    operationCalls.map((call) => `${call.model}.${call.method}`),
    [
      "repoMember.deleteMany",
      "video.deleteMany",
      "recordingSegment.deleteMany",
      "recordingSession.deleteMany",
      "repository.delete",
    ],
  );
  assert.equal(transactionOperations.length, 5);
  assert.deepEqual(operationCalls.find((call) => call.model === "recordingSession")?.args, {
    where: { repositoryId: repository.id },
  });
});
