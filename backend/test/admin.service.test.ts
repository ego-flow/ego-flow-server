import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { Prisma, UserRole } from "@prisma/client";

import { AppError } from "../src/lib/errors";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const fakePrisma: any = {
  user: {
    findUnique: async () => null,
    create: async () => ({
      id: "alice",
      role: UserRole.user,
      displayName: "Alice Kim",
      createdAt: new Date("2026-04-25T00:00:00.000Z"),
      isActive: true,
    }),
    delete: async () => ({ id: "alice" }),
  },
  repository: {
    findMany: async () => [],
  },
  repoMember: {
    findMany: async () => [],
  },
  recordingSession: {
    count: async () => 0,
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { AdminService } = require("../src/services/admin.service") as typeof import("../src/services/admin.service");

const service = new AdminService();

beforeEach(() => {
  fakePrisma.user.findUnique = async () => null;
  fakePrisma.user.create = async () => ({
    id: "alice",
    role: UserRole.user,
    displayName: "Alice Kim",
    createdAt: new Date("2026-04-25T00:00:00.000Z"),
    isActive: true,
  });
  fakePrisma.user.delete = async () => ({ id: "alice" });
  fakePrisma.repository.findMany = async () => [];
  fakePrisma.repoMember.findMany = async () => [];
  fakePrisma.recordingSession.count = async () => 0;
});

test("createUser returns 409 when the id already exists before create", async () => {
  fakePrisma.user.findUnique = async () => ({ id: "alice" });

  await assert.rejects(
    service.createUser({
      id: "alice",
      password: "changeme123",
      displayName: "Alice Kim",
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "CONFLICT" &&
      error.message === "User id already exists.",
  );
});

test("createUser converts Prisma unique constraint races into 409", async () => {
  fakePrisma.user.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`id`)", {
      code: "P2002",
      clientVersion: "test",
      meta: { modelName: "User", target: ["id"] },
    });
  };

  await assert.rejects(
    service.createUser({
      id: "alice",
      password: "changeme123",
      displayName: "Alice Kim",
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "CONFLICT" &&
      error.message === "User id already exists.",
  );
});

test("getUserDeleteReadiness returns can_delete=true for a clean deactivated user", async () => {
  fakePrisma.user.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    isActive: false,
  });

  const readiness = await service.getUserDeleteReadiness("alice");

  assert.deepEqual(readiness, {
    user_id: "alice",
    can_delete: true,
    checks: {
      is_deactivated: true,
      owned_repository_count: 0,
      repository_membership_count: 0,
      recording_session_count: 0,
    },
  });
});

test("permanentlyDeleteUser rejects active users", async () => {
  fakePrisma.user.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    isActive: true,
  });

  await assert.rejects(
    service.permanentlyDeleteUser("alice"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR" &&
      error.message === "Deactivate the user before permanent deletion.",
  );
});

test("permanentlyDeleteUser rejects users with remaining blockers", async () => {
  fakePrisma.user.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    isActive: false,
  });
  fakePrisma.repository.findMany = async () => [{ id: "repo-1" }];

  await assert.rejects(
    service.permanentlyDeleteUser("alice"),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 409 &&
      error.code === "CONFLICT" &&
      error.message === "User cannot be permanently deleted while repositories, memberships, or recording history remain.",
  );
});

test("permanentlyDeleteUser deletes a clean deactivated user", async () => {
  let deletedUserId: string | null = null;

  fakePrisma.user.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    isActive: false,
  });
  fakePrisma.user.delete = async ({ where }: { where: { id: string } }) => {
    deletedUserId = where.id;
    return { id: where.id };
  };

  const result = await service.permanentlyDeleteUser("alice");

  assert.deepEqual(result, {
    id: "alice",
    deleted: true,
  });
  assert.equal(deletedUserId, "alice");
});
