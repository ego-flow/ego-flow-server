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
