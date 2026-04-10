import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { StreamConnectionMetadata, StreamOwnerLease } from "../src/types/stream";
import { FakeRedis } from "./helpers/fake-redis";

const fakeRedis = new FakeRedis();

(globalThis as any).__egoflowRedis = fakeRedis;

const { StreamOwnershipService } =
  require("../src/services/stream-ownership.service") as typeof import("../src/services/stream-ownership.service");

const service = new StreamOwnershipService();

const publishParams = {
  recordingSessionId: "session-1",
  repositoryId: "repo-1",
  repositoryName: "repo-name",
  userId: "user-1",
  streamPath: "live/repo-name",
};

beforeEach(() => {
  fakeRedis.clear();
});

test("issuePublishTicket rejects reconnect takeover until the owner is actually stale", async () => {
  const firstGrant = await service.issuePublishTicket(publishParams);
  const streamId = service.buildStreamId(publishParams.repositoryId);
  const ownerKey = `stream:${streamId}:owner`;
  const connectionKey = `conn:${firstGrant.ticket.connectionId}`;
  const now = Date.now();

  const owner = fakeRedis.getJson<StreamOwnerLease>(ownerKey);
  const connection = fakeRedis.getJson<StreamConnectionMetadata>(connectionKey);

  assert.ok(owner);
  assert.ok(connection);

  fakeRedis.setJson(ownerKey, {
    ...owner,
    status: "claimed",
    lastHeartbeatAt: now - 16_000,
    leaseExpiresAt: now + 30_000,
  });
  fakeRedis.setJson(connectionKey, {
    ...connection,
    status: "claimed",
    lastHeartbeatAt: now - 16_000,
    leaseExpiresAt: now + 30_000,
  });

  let claimedRejection: unknown;
  try {
    await service.issuePublishTicket(publishParams);
  } catch (error) {
    claimedRejection = error;
  }

  assert.deepEqual(claimedRejection, {
    outcome: "rejected",
    existing: {
      ...owner,
      status: "claimed",
      lastHeartbeatAt: now - 16_000,
      leaseExpiresAt: now + 30_000,
    },
  });
  assert.equal(
    service.isStaleOwner({
      ...owner,
      status: "claimed",
      lastHeartbeatAt: now - 16_000,
      leaseExpiresAt: now + 30_000,
    }),
    false,
  );

  fakeRedis.setJson(ownerKey, {
    ...owner,
    status: "publishing",
    lastHeartbeatAt: now - 11_000,
    leaseExpiresAt: now + 30_000,
  });
  fakeRedis.setJson(connectionKey, {
    ...connection,
    status: "publishing",
    lastHeartbeatAt: now - 11_000,
    leaseExpiresAt: now + 30_000,
  });

  let rejection: unknown;
  try {
    await service.issuePublishTicket(publishParams);
  } catch (error) {
    rejection = error;
  }

  assert.deepEqual(rejection, {
    outcome: "rejected",
    existing: {
      ...owner,
      status: "publishing",
      lastHeartbeatAt: now - 11_000,
      leaseExpiresAt: now + 30_000,
    },
  });

  fakeRedis.setJson(ownerKey, {
    ...owner,
    status: "publishing",
    lastHeartbeatAt: now - 16_000,
    leaseExpiresAt: now + 30_000,
  });
  fakeRedis.setJson(connectionKey, {
    ...connection,
    status: "publishing",
    lastHeartbeatAt: now - 16_000,
    leaseExpiresAt: now + 30_000,
  });

  const reconnectGrant = await service.issuePublishTicket(publishParams);

  assert.equal(reconnectGrant.ownerOutcome, "takeover");
  assert.equal(reconnectGrant.ticket.recordingSessionId, publishParams.recordingSessionId);
  assert.equal(reconnectGrant.ticket.generation, firstGrant.ticket.generation + 1);
  assert.equal(reconnectGrant.revokedTicket?.status, "revoked");

  assert.equal(
    service.isStaleOwner({
      ...owner,
      status: "claimed",
      lastHeartbeatAt: now - 61_000,
      leaseExpiresAt: now - 1,
    }),
    true,
  );
});

test("refresh and release keep the current owner when generation does not match", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const wrongGeneration = grant.ticket.generation + 1;

  const ownerBefore = await service.getCurrentOwnerForRepository(publishParams.repositoryId);
  const connectionBefore = await service.getConnection(grant.ticket.connectionId);

  const refreshResult = await service.refreshConnectionLease({
    repositoryId: publishParams.repositoryId,
    recordingSessionId: publishParams.recordingSessionId,
    connectionId: grant.ticket.connectionId,
    generation: wrongGeneration,
  });

  assert.equal(refreshResult.outcome, "rejected");
  assert.equal(refreshResult.reason, "generation-mismatch");
  assert.deepEqual(await service.getCurrentOwnerForRepository(publishParams.repositoryId), ownerBefore);
  assert.deepEqual(await service.getConnection(grant.ticket.connectionId), connectionBefore);

  const releaseResult = await service.releaseConnectionLease({
    repositoryId: publishParams.repositoryId,
    recordingSessionId: publishParams.recordingSessionId,
    connectionId: grant.ticket.connectionId,
    generation: wrongGeneration,
  });

  assert.equal(releaseResult.outcome, "rejected");
  assert.equal(releaseResult.reason, "generation-mismatch");
  assert.deepEqual(await service.getCurrentOwnerForRepository(publishParams.repositoryId), ownerBefore);
  assert.deepEqual(await service.getConnection(grant.ticket.connectionId), connectionBefore);
});
