import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { AppError } from "../src/lib/core/errors";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;
(globalThis as any).__egoflowRedis = new FakeRedis();

const accessTokenLib =
  require("../src/lib/auth/access-token") as typeof import("../src/lib/auth/access-token");
const pythonToken =
  require("../src/lib/auth/python-token") as typeof import("../src/lib/auth/python-token");
const mutablePythonToken = pythonToken as unknown as {
  verifyPythonToken: typeof pythonToken.verifyPythonToken;
};
const { userRepository } =
  require("../src/repositories/user.repository") as typeof import("../src/repositories/user.repository");
const { requireDashboardOrAppOrPython } =
  require("../src/middleware/auth.middleware") as typeof import("../src/middleware/auth.middleware");

type HeaderMap = Record<string, string>;

const originalVerifyPythonToken = pythonToken.verifyPythonToken;
const originalFindActiveAuthenticatedUser = userRepository.findActiveAuthenticatedUser;
const originalVerifyAccessToken = accessTokenLib.verifyAccessToken;
const originalResolveRefreshedAccessToken = accessTokenLib.resolveRefreshedAccessToken;

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
  mutablePythonToken.verifyPythonToken = originalVerifyPythonToken;
  userRepository.findActiveAuthenticatedUser = originalFindActiveAuthenticatedUser;
  (accessTokenLib as any).verifyAccessToken = originalVerifyAccessToken;
  (accessTokenLib as any).resolveRefreshedAccessToken = originalResolveRefreshedAccessToken;
});

test("requireDashboardOrAppOrPython accepts ef_ Python tokens without emitting a refreshed header", async () => {
  let jwtVerified = false;

  mutablePythonToken.verifyPythonToken = async (token: string) => {
    assert.equal(token, "ef_0123456789abcdef0123456789abcdef01234567");
    return {
      userId: "alice",
      role: "user",
    };
  };
  userRepository.findActiveAuthenticatedUser = async (userId: string) => ({
    userId,
    role: "user",
    displayName: "Alice Kim",
  });
  (accessTokenLib as any).verifyAccessToken = (() => {
    jwtVerified = true;
    throw new Error("JWT path should not run");
  }) as typeof accessTokenLib.verifyAccessToken;

  const req: any = {
    headers: {
      authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567",
    },
    query: {},
  };
  const res = createResponse();
  let nextError: unknown = null;

  await requireDashboardOrAppOrPython(req, res as any, (error?: unknown) => {
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

test("requireDashboardOrAppOrPython keeps JWT refresh behavior for non-Python bearer tokens", async () => {
  (accessTokenLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof accessTokenLib.verifyAccessToken;
  (accessTokenLib as any).resolveRefreshedAccessToken =
    (() => "refreshed.jwt") as typeof accessTokenLib.resolveRefreshedAccessToken;
  userRepository.findActiveAuthenticatedUser = async () => ({
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

  await requireDashboardOrAppOrPython(req, res as any, (error?: unknown) => {
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

test("requireDashboardOrAppOrPython rejects invalid Python tokens with 401", async () => {
  mutablePythonToken.verifyPythonToken = async () => null;

  const req: any = {
    headers: {
      authorization: "Bearer ef_deadbeefdeadbeefdeadbeefdeadbeefdeadbe",
    },
    query: {},
  };
  const res = createResponse();
  let nextError: unknown = null;

  await requireDashboardOrAppOrPython(req, res as any, (error?: unknown) => {
    nextError = error ?? null;
  });

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 401);
  assert.equal(nextError.message, "Invalid token.");
});
