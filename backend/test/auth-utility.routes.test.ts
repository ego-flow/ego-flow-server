import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { errorMiddleware } from "../src/middleware/error.middleware";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
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

const { userRepository } =
  require("../src/repositories/user.repository") as typeof import("../src/repositories/user.repository");
const { apiTokenService } =
  require("../src/services/api-token.service") as typeof import("../src/services/api-token.service");
const { dashboardSessionService } =
  require("../src/services/dashboard-session.service") as typeof import("../src/services/dashboard-session.service");
const { authService } =
  require("../src/services/auth.service") as typeof import("../src/services/auth.service");
const { authRoutes } =
  require("../src/routes/auth.routes") as typeof import("../src/routes/auth.routes");
const { DASHBOARD_SESSION_COOKIE_NAME } =
  require("../src/constants/auth/auth-constants") as typeof import("../src/constants/auth/auth-constants");

const originalVerifyPythonToken = apiTokenService.verifyPythonToken;
const originalFindActiveAuthenticatedUser = userRepository.findActiveAuthenticatedUser;
const originalIssuePythonToken = authService.issuePythonToken;
const originalVerifyDashboardSession = dashboardSessionService.verifySession;

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
  fakeRedisModule.redis.clear();
  apiTokenService.verifyPythonToken = originalVerifyPythonToken;
  userRepository.findActiveAuthenticatedUser = originalFindActiveAuthenticatedUser;
  authService.issuePythonToken = originalIssuePythonToken;
  dashboardSessionService.verifySession = originalVerifyDashboardSession;
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

test("POST /auth/python/tokens issues a Python static token for a dashboard session", async () => {
  const baseUrl = await startServer();

  dashboardSessionService.verifySession = async (rawToken: string) => {
    assert.equal(rawToken, "dashboard-token");
    return {
      sessionId: "session-1",
      userId: "alice",
      role: "user",
      displayName: "Alice Kim",
    };
  };

  authService.issuePythonToken = async (userId, input) => {
    assert.equal(userId, "alice");
    assert.deepEqual(input, {
      name: "python-package",
    });

    return {
      id: "token-id",
      name: input.name,
      token: "ef_0123456789abcdef0123456789abcdef01234567",
      created_at: "2026-06-03T00:00:00.000Z",
      rotated_previous: false,
    };
  };

  const response = await fetch(`${baseUrl}/api/v1/auth/python/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${DASHBOARD_SESSION_COOKIE_NAME}=dashboard-token`,
    },
    body: JSON.stringify({
      name: "python-package",
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: "token-id",
    name: "python-package",
    token: "ef_0123456789abcdef0123456789abcdef01234567",
    created_at: "2026-06-03T00:00:00.000Z",
    rotated_previous: false,
  });
});

test("POST /auth/python/tokens rejects requests without a dashboard session", async () => {
  const baseUrl = await startServer();

  const response = await fetch(`${baseUrl}/api/v1/auth/python/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "python-package",
    }),
  });

  assert.equal(response.status, 401);
});

test("GET /auth/python/tokens/validate returns the Python token owner", async () => {
  const baseUrl = await startServer();
  const rawToken = "ef_0123456789abcdef0123456789abcdef01234567";

  apiTokenService.verifyPythonToken = async (token: string) => {
    assert.equal(token, rawToken);
    return {
      userId: "alice",
      role: "user",
    };
  };
  userRepository.findActiveAuthenticatedUser = async (userId: string) => {
    assert.equal(userId, "alice");
    return {
      userId,
      role: "user",
      displayName: "Alice Kim",
    };
  };

  const response = await fetch(`${baseUrl}/api/v1/auth/python/tokens/validate`, {
    headers: {
      Authorization: `Bearer ${rawToken}`,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    valid: true,
    user: {
      id: "alice",
      role: "user",
      display_name: "Alice Kim",
    },
  });
});

test("GET /auth/python/tokens/validate rejects invalid Python tokens", async () => {
  const baseUrl = await startServer();

  apiTokenService.verifyPythonToken = async () => null;

  const response = await fetch(`${baseUrl}/api/v1/auth/python/tokens/validate`, {
    headers: {
      Authorization: "Bearer ef_deadbeefdeadbeefdeadbeefdeadbeefdeadbe",
    },
  });

  assert.equal(response.status, 401);
});

test("legacy generic auth endpoints are not mounted", async () => {
  const baseUrl = await startServer();

  const validateResponse = await fetch(`${baseUrl}/api/v1/auth/validate`);
  assert.equal(validateResponse.status, 404);

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
  });
  assert.equal(loginResponse.status, 404);

  const tokenResponse = await fetch(`${baseUrl}/api/v1/auth/tokens`, {
    method: "POST",
  });
  assert.equal(tokenResponse.status, 404);
});

test("POST /auth/mediamtx accepts WebRTC publish when ticket matches stream path", async () => {
  const baseUrl = await startServer();
  await fakeRedisModule.redis.set(
    "stream:ticket:t_webrtc",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "maintainer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    60,
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "publish",
      path: "live/test2/11111111-1111-4111-8111-111111111111",
      protocol: "webrtc",
      query: "ticket=t_webrtc",
      id: "whip-source-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(fakeRedisModule.redis.getTtlSeconds("stream:ticket:t_webrtc"), 60);
});

test("POST /auth/mediamtx rejects WebRTC publish legacy credentials", async () => {
  const baseUrl = await startServer();
  await fakeRedisModule.redis.set(
    "stream:ticket:t_webrtc",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "maintainer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    60,
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "publish",
      path: "live/test2/11111111-1111-4111-8111-111111111111",
      protocol: "webrtc",
      query: "ticket=t_webrtc&token=legacy-token",
      id: "whip-source-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 401);
});

test("POST /auth/mediamtx accepts HLS playback with playback ticket and active Redis cache", async () => {
  const baseUrl = await startServer();
  fakeRedisModule.redis.setJson("stream:recording:11111111-1111-4111-8111-111111111111", {
    repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
    repositoryName: "test2",
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  });
  await fakeRedisModule.redis.set(
    "stream:hls-ticket:pt_hls",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "viewer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    600,
  );
  await fakeRedisModule.redis.expire("stream:hls-ticket:pt_hls", 5);

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "read",
      path: "live/test2/11111111-1111-4111-8111-111111111111",
      protocol: "hls",
      query: "ticket=pt_hls&user_id=viewer-1",
      id: "hls-reader-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(fakeRedisModule.redis.getTtlSeconds("stream:hls-ticket:pt_hls"), 600);
});

test("POST /auth/mediamtx rejects HLS playback when playback ticket targets another path", async () => {
  const baseUrl = await startServer();
  fakeRedisModule.redis.setJson("stream:recording:11111111-1111-4111-8111-111111111111", {
    repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
    repositoryName: "test2",
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  });
  await fakeRedisModule.redis.set(
    "stream:hls-ticket:pt_hls",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "viewer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    600,
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "read",
      path: "live/other/11111111-1111-4111-8111-111111111111",
      protocol: "hls",
      query: "ticket=pt_hls&user_id=viewer-1",
      id: "hls-reader-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 401);
});

test("POST /auth/mediamtx rejects playback action for HLS auth", async () => {
  const baseUrl = await startServer();
  fakeRedisModule.redis.setJson("stream:recording:11111111-1111-4111-8111-111111111111", {
    repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
    repositoryName: "test2",
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  });
  await fakeRedisModule.redis.set(
    "stream:hls-ticket:pt_hls",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "viewer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    600,
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "playback",
      path: "live/test2/11111111-1111-4111-8111-111111111111",
      protocol: "hls",
      query: "ticket=pt_hls&user_id=viewer-1",
      id: "hls-reader-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 401);
});

test("POST /auth/mediamtx rejects HLS playback when playback ticket user mismatches", async () => {
  const baseUrl = await startServer();
  fakeRedisModule.redis.setJson("stream:recording:11111111-1111-4111-8111-111111111111", {
    repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
    repositoryName: "test2",
    userId: "maintainer-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  });
  await fakeRedisModule.redis.set(
    "stream:hls-ticket:pt_hls",
    JSON.stringify({
      recordingSessionId: "11111111-1111-4111-8111-111111111111",
      repositoryId: "566fdab1-771a-42f9-a4eb-2f1c04859874",
      userId: "viewer-1",
      ingestType: "MEDIAMTX",
      streamPath: "live/test2/11111111-1111-4111-8111-111111111111",
      status: "active",
    }),
    "EX",
    600,
  );

  const response = await fetch(`${baseUrl}/api/v1/auth/mediamtx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "read",
      path: "live/test2/11111111-1111-4111-8111-111111111111",
      protocol: "hls",
      query: "ticket=pt_hls&user_id=viewer-2",
      id: "hls-reader-1",
      ip: "203.0.113.10",
    }),
  });

  assert.equal(response.status, 401);
});
