import assert from "node:assert/strict";
import { RepoRole } from "@prisma/client";
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
  deactivated: false,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
};

const transactionOperations: unknown[] = [];
const operationCalls: Array<{ model: string; method: string; args?: unknown }> = [];

const fakePrisma: any = {
  repository: {
    findUnique: async () => repository,
    findMany: async () => [],
    update: (args: unknown) => {
      operationCalls.push({ model: "repository", method: "update", args });
      return { ...repository, deactivated: true };
    },
    delete: (args: unknown) => {
      operationCalls.push({ model: "repository", method: "delete", args });
      return { model: "repository", method: "delete" };
    },
  },
  repoMember: {
    findMany: async () => [],
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "repoMember", method: "deleteMany", args });
      return { model: "repoMember", method: "deleteMany" };
    },
  },
  video: {
    findMany: async () => [],
    groupBy: async () => [],
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "video", method: "deleteMany", args });
      return { model: "video", method: "deleteMany" };
    },
  },
  recordingSession: {
    findFirst: async () => null,
    count: async () => 0,
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "recordingSession", method: "deleteMany", args });
      return { model: "recordingSession", method: "deleteMany" };
    },
  },
  recordingSegment: {
    findFirst: async () => null,
    count: async () => 0,
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
  fakePrisma.repository.findMany = async () => [];
  fakePrisma.repoMember.findMany = async () => [];
  fakePrisma.video.findMany = async () => [];
  fakePrisma.video.groupBy = async () => [];
  fakePrisma.recordingSession.findFirst = async () => null;
  fakePrisma.recordingSession.count = async () => 0;
  fakePrisma.recordingSegment.findFirst = async () => null;
  fakePrisma.recordingSegment.count = async () => 0;
});

test("deactivateRepository marks repository deactivated without blocking active work", async () => {
  fakePrisma.recordingSession.findFirst = async () => {
    throw new Error("deactivateRepository should not check active sessions");
  };
  fakePrisma.recordingSegment.findFirst = async () => {
    throw new Error("deactivateRepository should not check recording segments");
  };

  const result = await repositoryService.deactivateRepository("admin", "admin", repository.id);

  assert.deepEqual(result, {
    id: repository.id,
    deactivated: true,
  });
  assert.deepEqual(operationCalls.map((call) => `${call.model}.${call.method}`), [
    "repository.update",
  ]);
});

test("getRepositoryDeleteReadiness requires deactivation and no active work", async () => {
  fakePrisma.recordingSession.count = async () => 1;

  const result = await repositoryService.getRepositoryDeleteReadiness("admin", "admin", repository.id);

  assert.deepEqual(result, {
    repository_id: repository.id,
    can_delete: false,
    checks: {
      is_deactivated: false,
      active_streaming_session_count: 1,
      finalizing_segment_count: 0,
    },
  });
});

test("listDeactivatedAdminRepositories returns deactivated repositories where user is admin", async () => {
  const memberFindCalls: unknown[] = [];
  const repositoryFindCalls: unknown[] = [];
  const groupByCalls: unknown[] = [];

  fakePrisma.repoMember.findMany = async (args: unknown) => {
    memberFindCalls.push(args);
    return [{ repositoryId: repository.id }];
  };
  fakePrisma.repository.findMany = async (args: unknown) => {
    repositoryFindCalls.push(args);
    return [{ ...repository, deactivated: true }];
  };
  fakePrisma.video.groupBy = async (args: unknown) => {
    groupByCalls.push(args);
    return [{ repositoryId: repository.id, _count: { _all: 2 } }];
  };

  const result = await repositoryService.listDeactivatedAdminRepositories("alice", "user");

  assert.deepEqual(memberFindCalls[0], {
    where: {
      userId: "alice",
      role: RepoRole.admin,
    },
    select: { repositoryId: true },
  });
  assert.deepEqual((repositoryFindCalls[0] as any).where, {
    id: { in: [repository.id] },
    deactivated: true,
  });
  assert.deepEqual((groupByCalls[0] as any).where, {
    repositoryId: { in: [repository.id] },
  });
  assert.deepEqual(result.repositories, [
    {
      id: repository.id,
      name: repository.name,
      owner_id: repository.ownerId,
      visibility: repository.visibility,
      description: repository.description,
      my_role: "admin",
      created_at: repository.createdAt.toISOString(),
      updated_at: repository.updatedAt.toISOString(),
      video_count: 2,
    },
  ]);
});

test("permanentlyDeleteRepository rejects an active repository", async () => {
  await assert.rejects(
    () => repositoryService.permanentlyDeleteRepository("admin", "admin", repository.id),
    (error: any) =>
      error?.code === "VALIDATION_ERROR" &&
      error?.message === "Deactivate the repository before permanent deletion.",
  );

  assert.equal(operationCalls.length, 0);
});

test("permanentlyDeleteRepository allows pending sessions and deletes repository-owned records", async () => {
  fakePrisma.repository.findUnique = async () => ({
    ...repository,
    deactivated: true,
  });

  const result = await repositoryService.permanentlyDeleteRepository("admin", "admin", repository.id);

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
