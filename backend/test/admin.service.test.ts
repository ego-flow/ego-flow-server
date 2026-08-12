import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { Prisma, UserRole } from "@prisma/client";

import { AppError } from "../src/lib/core/errors";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const fakePrisma: any = {
  users: {
    findUnique: async () => null,
    create: async () => ({
      id: "alice",
      role: UserRole.user,
      displayName: "Alice Kim",
      createdAt: new Date("2026-04-25T00:00:00.000Z"),
      deactivated: false,
    }),
    update: async () => ({ id: "alice" }),
    delete: async () => ({ id: "alice" }),
  },
  repositories: {
    findMany: async () => [],
  },
  repoMembers: {
    findMany: async () => [],
  },
  recordingSessions: {
    count: async () => 0,
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { AdminService } = require("../src/services/admin.service") as typeof import("../src/services/admin.service");

const service = new AdminService();

beforeEach(() => {
  fakePrisma.users.findUnique = async () => null;
  fakePrisma.users.create = async () => ({
    id: "alice",
    role: UserRole.user,
    displayName: "Alice Kim",
    createdAt: new Date("2026-04-25T00:00:00.000Z"),
    deactivated: false,
  });
  fakePrisma.users.update = async () => ({ id: "alice" });
  fakePrisma.users.delete = async () => ({ id: "alice" });
  fakePrisma.repositories.findMany = async () => [];
  fakePrisma.repoMembers.findMany = async () => [];
  fakePrisma.recordingSessions.count = async () => 0;
});

test("createUser returns 409 when the id already exists before create", async () => {
  fakePrisma.users.findUnique = async () => ({ id: "alice" });

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

test("createUser defaults a blank displayName to the user id", async () => {
  let createdDisplayName: string | null = null;
  fakePrisma.users.create = async ({ data }: { data: { displayName: string } }) => {
    createdDisplayName = data.displayName;
    return {
      id: "alice",
      role: UserRole.user,
      displayName: data.displayName,
      createdAt: new Date("2026-04-25T00:00:00.000Z"),
      deactivated: false,
    };
  };

  const response = await service.createUser({
    id: "alice",
    password: "changeme123",
    displayName: "",
  });

  assert.equal(createdDisplayName, "alice");
  assert.equal(response.user.displayName, "alice");
});

test("createUser lets Prisma unique-constraint races surface to the error middleware", async () => {
  fakePrisma.users.create = async () => {
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
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );
});

test("getUserDeleteReadiness returns can_delete=true for a clean deactivated user", async () => {
  fakePrisma.users.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    deactivated: true,
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

test("deactivateUser marks the user deactivated", async () => {
  let updateInput: { where: { id: string }; data: { deactivated: boolean } } | null = null;
  fakePrisma.users.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
  });
  fakePrisma.users.update = async (input: { where: { id: string }; data: { deactivated: boolean } }) => {
    updateInput = input;
    return { id: input.where.id };
  };

  const result = await service.deactivateUser("alice");

  assert.deepEqual(updateInput, {
    where: { id: "alice" },
    data: { deactivated: true },
  });
  assert.deepEqual(result, {
    id: "alice",
    deactivated: true,
  });
});

test("permanentlyDeleteUser rejects active users", async () => {
  fakePrisma.users.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    deactivated: false,
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
  fakePrisma.users.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    deactivated: true,
  });
  fakePrisma.repositories.findMany = async () => [{ id: "repo-1" }];

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

  fakePrisma.users.findUnique = async () => ({
    id: "alice",
    role: UserRole.user,
    deactivated: true,
  });
  fakePrisma.users.delete = async ({ where }: { where: { id: string } }) => {
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
