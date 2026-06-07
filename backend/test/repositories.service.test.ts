import assert from "node:assert/strict";
import { RepoRole } from "@prisma/client";
import { beforeEach, test } from "node:test";
import type { RepositoryAccessContext } from "../src/types/repository";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const repository = {
  id: "566fdab1-771a-42f9-a4eb-2f1c04859874",
  name: "test2",
  ownerId: "admin",
  visibility: "public",
  description: null,
  tags: [],
  deactivated: false,
  createdAt: new Date("2026-05-29T00:00:00.000Z"),
  updatedAt: new Date("2026-05-29T00:00:00.000Z"),
};

const transactionOperations: unknown[] = [];
const operationCalls: Array<{ model: string; method: string; args?: unknown }> = [];

const repositoryAccess = (): RepositoryAccessContext => ({
  repository: {
    id: repository.id,
    name: repository.name,
    ownerId: repository.ownerId,
    visibility: "public",
    description: repository.description,
    tags: repository.tags,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  },
  effectiveRole: "admin",
  isSystemAdmin: true,
});

const fakePrisma: any = {
  repositories: {
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
  repoMembers: {
    findMany: async () => [],
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "repoMember", method: "deleteMany", args });
      return { model: "repoMember", method: "deleteMany" };
    },
  },
  videos: {
    findMany: async () => [],
    groupBy: async () => [],
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "video", method: "deleteMany", args });
      return { model: "video", method: "deleteMany" };
    },
  },
  recordingSessions: {
    findFirst: async () => null,
    count: async () => 0,
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "recordingSession", method: "deleteMany", args });
      return { model: "recordingSession", method: "deleteMany" };
    },
  },
  recordingSegments: {
    findFirst: async () => null,
    count: async () => 0,
    deleteMany: (args: unknown) => {
      operationCalls.push({ model: "recordingSegment", method: "deleteMany", args });
      return { model: "recordingSegment", method: "deleteMany" };
    },
  },
  $transaction: async (operations: unknown[] | ((tx: unknown) => Promise<unknown>)) => {
    if (typeof operations === "function") {
      return operations(fakePrisma);
    }

    transactionOperations.push(...operations);
    return operations;
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { repositoriesService } =
  require("../src/services/repositories.service") as typeof import("../src/services/repositories.service");

beforeEach(() => {
  transactionOperations.length = 0;
  operationCalls.length = 0;
  fakePrisma.repositories.findUnique = async () => repository;
  fakePrisma.repositories.findMany = async () => [];
  fakePrisma.repoMembers.findMany = async () => [];
  fakePrisma.videos.findMany = async () => [];
  fakePrisma.videos.groupBy = async () => [];
  fakePrisma.recordingSessions.findFirst = async () => null;
  fakePrisma.recordingSessions.count = async () => 0;
  fakePrisma.recordingSegments.findFirst = async () => null;
  fakePrisma.recordingSegments.count = async () => 0;
});

test("deactivateRepository marks repository deactivated without blocking active work", async () => {
  fakePrisma.recordingSessions.findFirst = async () => {
    throw new Error("deactivateRepository should not check active sessions");
  };
  fakePrisma.recordingSegments.findFirst = async () => {
    throw new Error("deactivateRepository should not check recording segments");
  };

  const result = await repositoriesService.deactivateRepository(repositoryAccess());

  assert.deepEqual(result, {
    id: repository.id,
    deactivated: true,
  });
  assert.deepEqual(operationCalls.map((call) => `${call.model}.${call.method}`), [
    "repository.update",
  ]);
});

test("getRepositoryDeleteReadiness uses prevalidated deactivated repository access", async () => {
  fakePrisma.repositories.findUnique = async () => {
    throw new Error("getRepositoryDeleteReadiness should not recheck repository status");
  };
  fakePrisma.recordingSessions.count = async () => 1;

  const result = await repositoriesService.getRepositoryDeleteReadiness(repositoryAccess());

  assert.deepEqual(result, {
    repository_id: repository.id,
    can_delete: false,
    checks: {
      is_deactivated: true,
      active_streaming_session_count: 1,
      finalizing_segment_count: 0,
    },
  });
});

test("getRepositoryDeleteReadiness returns delete checks for deactivated repositories", async () => {
  fakePrisma.recordingSessions.count = async () => 1;

  const result = await repositoriesService.getRepositoryDeleteReadiness(repositoryAccess());

  assert.deepEqual(result, {
    repository_id: repository.id,
    can_delete: false,
    checks: {
      is_deactivated: true,
      active_streaming_session_count: 1,
      finalizing_segment_count: 0,
    },
  });
});

test("listDeactivatedAdminRepositories returns deactivated repositories where user is admin", async () => {
  const memberFindCalls: unknown[] = [];
  const repositoryFindCalls: unknown[] = [];
  const groupByCalls: unknown[] = [];

  fakePrisma.repoMembers.findMany = async (args: unknown) => {
    memberFindCalls.push(args);
    return [{ repositoryId: repository.id }];
  };
  fakePrisma.repositories.findMany = async (args: unknown) => {
    repositoryFindCalls.push(args);
    return [{ ...repository, deactivated: true }];
  };
  fakePrisma.videos.groupBy = async (args: unknown) => {
    groupByCalls.push(args);
    return [{ repositoryId: repository.id, _count: { _all: 2 } }];
  };

  const result = await repositoriesService.listDeactivatedAdminRepositories("alice", "user");

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
      tags: repository.tags,
      my_role: "admin",
      created_at: repository.createdAt.toISOString(),
      updated_at: repository.updatedAt.toISOString(),
      video_count: 2,
    },
  ]);
});

test("permanentlyDeleteRepository rejects active repository work after route validation", async () => {
  fakePrisma.recordingSessions.count = async () => 1;

  await assert.rejects(
    () => repositoriesService.permanentlyDeleteRepository(repositoryAccess()),
    (error: any) =>
      error?.code === "CONFLICT" &&
      error?.message === "Repository cannot be permanently deleted while streams or recording finalization are active.",
  );

  assert.equal(operationCalls.length, 0);
});

test("permanentlyDeleteRepository allows pending sessions and deletes repository-owned records", async () => {
  const result = await repositoriesService.permanentlyDeleteRepository(repositoryAccess());

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
  assert.equal(transactionOperations.length, 0);
  assert.deepEqual(operationCalls.find((call) => call.model === "recordingSession")?.args, {
    where: { repositoryId: repository.id },
  });
});
