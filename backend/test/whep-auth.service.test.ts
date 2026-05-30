import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { FakeRedis } from "./helpers/fake-redis";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const moduleLoader = require("node:module") as typeof import("node:module") & {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;

moduleLoader._load = ((request: string, parent: unknown, isMain: boolean) => {
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

const fakeRedis = new FakeRedis();

(globalThis as any).__egoflowRedis = fakeRedis;
(globalThis as any).__egoflowPrisma = {} as any;

const { repositoryService } =
  require("../src/services/repository.service") as typeof import("../src/services/repository.service");
const { streamService } =
  require("../src/services/stream.service") as typeof import("../src/services/stream.service");
const { whepAuthService } =
  require("../src/services/whep-auth.service") as typeof import("../src/services/whep-auth.service");

const originalFindLiveSessionByStreamPath = streamService.findLiveSessionByStreamPath;
const originalGetRepositoryAccess = repositoryService.getRepositoryAccess;

beforeEach(() => {
  fakeRedis.clear();
  streamService.findLiveSessionByStreamPath = originalFindLiveSessionByStreamPath;
  repositoryService.getRepositoryAccess = originalGetRepositoryAccess;
});

test("authorize accepts native WHEP paths and session paths", async () => {
  const lookedUpPaths: string[] = [];
  streamService.findLiveSessionByStreamPath = async (streamPath: string) => {
    lookedUpPaths.push(streamPath);
    return {
      recordingSessionId: "session-1",
      repositoryId: "repo-1",
      repositoryName: "repo-name",
      ownerId: "owner-1",
      userId: "user-1",
      targetDirectory: "/data/raw",
      registeredAt: new Date("2026-05-27T00:00:00.000Z").toISOString(),
      status: "STREAMING",
    };
  };
  repositoryService.getRepositoryAccess = async () => ({ repository: { id: "repo-1" } }) as any;

  const initial = await whepAuthService.authorize({
    rawCredential: "credential-1",
    path: "/live/repo-name/session-1/whep",
    userId: "viewer-1",
    userRole: "user",
  });
  const session = await whepAuthService.authorize({
    rawCredential: "credential-2",
    path: "/live/repo-name/session-1/whep/webrtc-session-id",
    userId: "viewer-1",
    userRole: "user",
  });

  assert.deepEqual(initial, { ok: true, repoName: "repo-name", cached: false });
  assert.deepEqual(session, { ok: true, repoName: "repo-name", cached: false });
  assert.deepEqual(lookedUpPaths, ["live/repo-name/session-1", "live/repo-name/session-1"]);
});

test("authorize rejects the retired /whep/{repo} public path shape", async () => {
  let lookedUp = false;
  streamService.findLiveSessionByStreamPath = async () => {
    lookedUp = true;
    return null;
  };

  const outcome = await whepAuthService.authorize({
    rawCredential: "credential-1",
    path: "/whep/repo-name",
    userId: "viewer-1",
    userRole: "user",
  });

  assert.deepEqual(outcome, { ok: false, reason: "invalid-path" });
  assert.equal(lookedUp, false);
});
