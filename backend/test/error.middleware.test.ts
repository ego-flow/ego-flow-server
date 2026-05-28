import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError, z } from "zod";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const { errorMiddleware } = require("../src/middleware/error.middleware") as typeof import("../src/middleware/error.middleware");
const { AppError, ErrorCode } = require("../src/lib/errors") as typeof import("../src/lib/errors");

interface CapturedResponse {
  statusCode: number;
  body: any;
}

const captureResponse = (): { res: Response; captured: CapturedResponse } => {
  const captured: CapturedResponse = { statusCode: 0, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;

  return { res, captured };
};

const fakeRequest = () =>
  ({
    method: "GET",
    originalUrl: "/api/v1/test",
  }) as unknown as Request;

test("errorMiddleware passes AppError through as-is", () => {
  const { res, captured } = captureResponse();
  errorMiddleware(new AppError(418, "TEA", "I am a teapot.", { foo: 1 }), fakeRequest(), res, () => {});

  assert.equal(captured.statusCode, 418);
  assert.deepEqual(captured.body, {
    error: { code: "TEA", message: "I am a teapot.", details: { foo: 1 } },
  });
});

test("errorMiddleware maps ZodError to 400 VALIDATION_ERROR", () => {
  const schema = z.object({ name: z.string() });
  let zodError: ZodError | null = null;
  try {
    schema.parse({ name: 123 });
  } catch (error) {
    zodError = error as ZodError;
  }
  assert.ok(zodError, "expected ZodError to be thrown");

  const { res, captured } = captureResponse();
  errorMiddleware(zodError, fakeRequest(), res, () => {});

  assert.equal(captured.statusCode, 400);
  assert.equal(captured.body.error.code, ErrorCode.VALIDATION_ERROR);
  assert.ok(captured.body.error.details);
});

test("errorMiddleware maps Prisma P2002 to 409 CONFLICT", () => {
  const prismaError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`id`)", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "User", target: ["id"] },
  });

  const { res, captured } = captureResponse();
  errorMiddleware(prismaError, fakeRequest(), res, () => {});

  assert.equal(captured.statusCode, 409);
  assert.equal(captured.body.error.code, ErrorCode.CONFLICT);
  assert.deepEqual(captured.body.error.details, { target: ["id"] });
});

test("errorMiddleware maps Prisma P2025 to 404 NOT_FOUND", () => {
  const prismaError = new Prisma.PrismaClientKnownRequestError("Record to update not found.", {
    code: "P2025",
    clientVersion: "test",
  });

  const { res, captured } = captureResponse();
  errorMiddleware(prismaError, fakeRequest(), res, () => {});

  assert.equal(captured.statusCode, 404);
  assert.equal(captured.body.error.code, ErrorCode.NOT_FOUND);
});

test("errorMiddleware falls back to 500 INTERNAL_ERROR for unknown errors", () => {
  const { res, captured } = captureResponse();
  errorMiddleware(new Error("boom"), fakeRequest(), res, () => {});

  assert.equal(captured.statusCode, 500);
  assert.equal(captured.body.error.code, ErrorCode.INTERNAL_ERROR);
});
