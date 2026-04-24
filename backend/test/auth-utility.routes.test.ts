import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { errorMiddleware } from "../src/middleware/error.middleware";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;
(globalThis as any).__egoflowRedis = new FakeRedis();

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
const fakeRedisModule = { redis: new FakeRedis() };

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
  if (request === "../lib/redis" || request.endsWith("/lib/redis")) {
    return fakeRedisModule;
  }

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

const jwtLib = require("../src/lib/jwt") as typeof import("../src/lib/jwt");
const { adminService } =
  require("../src/services/admin.service") as typeof import("../src/services/admin.service");
const { apiTokenService } =
  require("../src/services/api-token.service") as typeof import("../src/services/api-token.service");
const { authRoutes } =
  require("../src/routes/auth.routes") as typeof import("../src/routes/auth.routes");

const originalVerifyPythonToken = apiTokenService.verifyPythonToken;
const originalGetAuthenticatedUser = adminService.getAuthenticatedUser;
const originalVerifyAccessToken = jwtLib.verifyAccessToken;
const originalShouldRefreshToken = jwtLib.shouldRefreshToken;

let server: import("node:http").Server | null = null;

const startServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use(errorMiddleware);

  server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

beforeEach(() => {
  apiTokenService.verifyPythonToken = originalVerifyPythonToken;
  adminService.getAuthenticatedUser = originalGetAuthenticatedUser;
  (jwtLib as any).verifyAccessToken = originalVerifyAccessToken;
  (jwtLib as any).shouldRefreshToken = originalShouldRefreshToken;
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  }
});

test("GET /auth/validate returns the authenticated user for JWT and Python tokens", async () => {
  const baseUrl = await startServer();

  (jwtLib as any).verifyAccessToken = (() => ({
    userId: "alice",
    role: "user",
  })) as typeof jwtLib.verifyAccessToken;
  (jwtLib as any).shouldRefreshToken = (() => false) as typeof jwtLib.shouldRefreshToken;
  adminService.getAuthenticatedUser = async (userId: string) => ({
    userId,
    role: "user",
    displayName: "Alice Kim",
  });
  apiTokenService.verifyPythonToken = async () => ({
    userId: "alice",
    role: "user",
  });

  const jwtResponse = await fetch(`${baseUrl}/api/v1/auth/validate`, {
    headers: {
      Authorization: "Bearer jwt-token",
    },
  });
  assert.equal(jwtResponse.status, 200);
  assert.deepEqual(await jwtResponse.json(), {
    user: {
      id: "alice",
      role: "user",
      display_name: "Alice Kim",
    },
    auth: {
      kind: "app",
    },
  });

  const pythonResponse = await fetch(`${baseUrl}/api/v1/auth/validate`, {
    headers: {
      Authorization: "Bearer ef_0123456789abcdef0123456789abcdef01234567",
    },
  });
  assert.equal(pythonResponse.status, 200);
  assert.deepEqual(await pythonResponse.json(), {
    user: {
      id: "alice",
      role: "user",
      display_name: "Alice Kim",
    },
    auth: {
      kind: "python",
    },
  });
});

test("GET /auth/validate returns 401 for an invalid token", async () => {
  const baseUrl = await startServer();

  apiTokenService.verifyPythonToken = async () => null;

  const response = await fetch(`${baseUrl}/api/v1/auth/validate`, {
    headers: {
      Authorization: "Bearer ef_deadbeefdeadbeefdeadbeefdeadbeefdeadbe",
    },
  });

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});
