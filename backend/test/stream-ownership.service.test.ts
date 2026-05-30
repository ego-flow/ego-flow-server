import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { PublishTicketRecord } from "../src/types/stream";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const fakeRedis = new FakeRedis();

(globalThis as any).__egoflowRedis = fakeRedis;

const { StreamOwnershipService } =
  require("../src/services/stream-ownership.service") as typeof import("../src/services/stream-ownership.service");

const service = new StreamOwnershipService();

const publishParams = {
  recordingSessionId: "session-1",
  repositoryId: "repo-1",
  userId: "user-1",
  streamPath: "live/repo-name/session-1",
};

beforeEach(() => {
  fakeRedis.clear();
});

test("buildWhipPublishUrl uses the MediaMTX native WHIP path shape", () => {
  assert.equal(
    service.buildWhipPublishUrl("https://streams.example.com/live/", "live/repo-name/session-1", "ticket value"),
    "https://streams.example.com/live/repo-name/session-1/whip?ticket=ticket%20value",
  );
});

test("issuePublishTicket stores only short-lived ticket metadata", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const stored = fakeRedis.getJson<PublishTicketRecord>(`stream:ticket:${grant.ticket.ticketId}`);

  assert.ok(grant.ticket.ticketId.startsWith("t_"));
  assert.deepEqual(stored, grant.ticket);
  assert.equal(stored?.recordingSessionId, publishParams.recordingSessionId);
  assert.equal(stored?.repositoryId, publishParams.repositoryId);
  assert.equal(stored?.userId, publishParams.userId);
  assert.equal(stored?.streamPath, publishParams.streamPath);
  assert.equal(stored?.status, "active");
});

test("validate and consume publish ticket only depend on ticket state and stream path", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const query = `ticket=${encodeURIComponent(grant.ticket.ticketId)}`;

  const validation = await service.validatePublishTicket(publishParams.streamPath, query);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.ticket.recordingSessionId, publishParams.recordingSessionId);
  }

  const pathMismatch = await service.validatePublishTicket("live/other/session-1", query);
  assert.deepEqual(pathMismatch, {
    ok: false,
    reason: "ticket-stream-path-mismatch",
    ticketId: grant.ticket.ticketId,
  });

  const consumed = await service.consumePublishTicket(publishParams.streamPath, query);
  assert.equal(consumed.ok, true);

  const afterConsume = await service.validatePublishTicket(publishParams.streamPath, query);
  assert.deepEqual(afterConsume, {
    ok: false,
    reason: "ticket-status-consumed",
    ticketId: grant.ticket.ticketId,
  });
});
