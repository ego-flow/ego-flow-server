import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { AppError } from "../src/lib/errors";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;
(globalThis as any).__egoflowRedis = new FakeRedis();

const jwtLib = require("../src/lib/jwt") as typeof import("../src/lib/jwt");
const { adminService } =
  require("../src/services/admin.service") as typeof import("../src/services/admin.service");
const { apiTokenService } =
  require("../src/services/api-token.service") as typeof import("../src/services/api-token.service");
const { requireAuth } =
  require("../src/middleware/auth.middleware") as typeof import("../src/middleware/auth.middleware");

type HeaderMap = Record<string, string>;

const originalVerifyPythonToken = apiTokenService.verifyPythonToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;
const originalSignAccessToken = jwtLib.signAccessToken;

const createResponse = () => {
  const headers: HeaderMap = {};

  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
};

beforeEach(() => {
  apiTokenService.verifyPythonToken = originalVerifyPythonToken;
  adminService.getAuthenticatedUser = originalGetAuthenticatedUser;
  (jwtLib as any).verifyAccessToken = originalVerifyAccessToken;
  (jwtLib as any).shouldRefreshToken = originalShouldRefreshToken;
  (jwtLib as any).signAccessToken = originalSignAccessToken;
});

test("requireAuth accepts ef_ Python tokens without emitting a refreshed header", async () => {
  let jwtVerified = false;

  apiTokenService.verifyPythonToken = async (token: string) => {
    assert.equal(token, "ef_0123456789abcdef0123456789abcdef01234567");
    return {
      userId: "alice",
      role: "user",
    };
  };
  adminService.getAuthenticatedUser = async (userId: string) => ({
    userId,
    role: "user",
    displayName: "Alice Kim",
  });
  (jwtLib as any).verifyAccessToken = (() => {
    jwtVerified = true;
    throw new Error("JWT path should not run");
  }) as typeof jwtLib.verifyAccessToken;

  const req: any = {
    headers: {
      authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567",
    },
    query: {},
  };
  const res = createResponse();
  let nextError: unknown = null;

  await requireAuth(req, res as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.equal(jwtVerified, false);
  assert.deepEqual(req.user, {
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  assert.equal(res.headers["X-Refreshed-Token"], undefined);
});

test("requireAuth keeps the JWT refresh behavior for non-Python bearer tokens", async () => {
  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => true) as typeof jwtLib.shouldRefreshToken;
  (jwtLib as any).signAccessToken = (() => "refreshed.jwt") as typeof jwtLib.signAccessToken;
  adminService.getAuthenticatedUser = async () => ({
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });

  const req: any = {
    headers: {
      authorization: "Bearer jwt-token",
    },
    query: {},
  };
  const res = createResponse();
  let nextError: unknown = null;

  await requireAuth(req, res as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.equal(nextError, null);
  assert.deepEqual(req.user, {
    userId: "alice",
    role: "user",
    displayName: "Alice Kim",
  });
  assert.equal(res.headers["X-Refreshed-Token"], "refreshed.jwt");
});

test("requireAuth rejects invalid Python tokens with 401", async () => {
  apiTokenService.verifyPythonToken = async () => null;

  const req: any = {
    headers: {
      authorization: "Bearer ef_deadbeefdeadbeefdeadbeefdeadbeefdeadbe",
    },
    query: {},
  };
  const res = createResponse();
  let nextError: unknown = null;

  await requireAuth(req, res as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 401);
  assert.equal(nextError.message, "Invalid token.");
});
