import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { HlsPlaybackTicketRecord, PublishTicketRecord, RecordingSessionLiveCache } from "../src/types/stream";
import { FakeRedis } from "./helpers/fake-redis";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
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
  ingestType: "MEDIAMTX" as const,
  streamPath: "live/repo-name/session-1",
};

beforeEach(() => {
  fakeRedis.clear();
});

test("issuePublishTicket stores only short-lived ticket metadata", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const stored = fakeRedis.getJson<PublishTicketRecord>(`stream:ticket:${grant.ticketId}`);

  assert.ok(grant.ticketId.startsWith("t_"));
  assert.deepEqual(stored, grant.ticket);
  assert.equal(stored?.recordingSessionId, publishParams.recordingSessionId);
  assert.equal(stored?.repositoryId, publishParams.repositoryId);
  assert.equal(stored?.userId, publishParams.userId);
  assert.equal(stored?.ingestType, publishParams.ingestType);
  assert.equal(stored?.streamPath, publishParams.streamPath);
  assert.equal(stored?.status, "active");
  assert.equal(Object.hasOwn(stored ?? {}, "ticketId"), false);
  assert.equal(Object.hasOwn(stored ?? {}, "issuedAt"), false);
  assert.equal(Object.hasOwn(stored ?? {}, "expiresAt"), false);
  assert.equal(fakeRedis.getTtlSeconds(`stream:ticket:${grant.ticketId}`), 60);
});

test("validate and consume publish ticket only depend on ticket state and stream path", async () => {
  const grant = await service.issuePublishTicket(publishParams);

  const validation = await service.validatePublishTicket(publishParams.streamPath, grant.ticketId);
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.equal(validation.ticket.recordingSessionId, publishParams.recordingSessionId);
  }
  assert.equal(fakeRedis.getTtlSeconds(`stream:ticket:${grant.ticketId}`), 60);

  const pathMismatch = await service.validatePublishTicket("live/other/session-1", grant.ticketId);
  assert.deepEqual(pathMismatch, {
    ok: false,
    reason: "ticket-stream-path-mismatch",
    ticketId: grant.ticketId,
  });

  const ingestTypeMismatch = await service.validatePublishTicket(publishParams.streamPath, grant.ticketId, {
    expectedIngestType: "HTTP",
  });
  assert.deepEqual(ingestTypeMismatch, {
    ok: false,
    reason: "ticket-ingest-type-mismatch",
    ticketId: grant.ticketId,
  });

  const consumed = await service.consumePublishTicket(publishParams.streamPath, grant.ticketId);
  assert.equal(consumed.ok, true);
  assert.equal(fakeRedis.getTtlSeconds(`stream:ticket:${grant.ticketId}`), 60);

  const afterConsume = await service.validatePublishTicket(publishParams.streamPath, grant.ticketId);
  assert.deepEqual(afterConsume, {
    ok: false,
    reason: "ticket-status-consumed",
    ticketId: grant.ticketId,
  });
});

test("validatePublishTicket refreshes the ticket TTL on successful verification", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const key = `stream:ticket:${grant.ticketId}`;

  await fakeRedis.expire(key, 5);

  const validation = await service.validatePublishTicket(publishParams.streamPath, grant.ticketId);

  assert.equal(validation.ok, true);
  assert.equal(fakeRedis.getTtlSeconds(key), 60);
});

test("consumePublishTicket preserves the remaining ticket TTL", async () => {
  const grant = await service.issuePublishTicket(publishParams);
  const key = `stream:ticket:${grant.ticketId}`;

  await fakeRedis.expire(key, 5);

  const consumed = await service.consumePublishTicket(publishParams.streamPath, grant.ticketId);

  assert.equal(consumed.ok, true);
  assert.equal(fakeRedis.getTtlSeconds(key), 5);
  assert.equal(fakeRedis.getJson<PublishTicketRecord>(key)?.status, "consumed");
});

test("issue and validate HLS playback ticket through Redis live cache", async () => {
  fakeRedis.setJson("stream:recording:session-1", {
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "publisher-1",
    ingestType: "MEDIAMTX",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  const grant = await service.issueHlsPlaybackTicket({
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    userId: "viewer-1",
    streamPath: "live/repo-name/session-1",
  });
  const key = `stream:hls-ticket:${grant.ticketId}`;
  const stored = fakeRedis.getJson<HlsPlaybackTicketRecord>(key);

  assert.ok(grant.ticketId.startsWith("pt_"));
  assert.deepEqual(stored, grant.ticket);
  assert.equal(fakeRedis.getTtlSeconds(key), 600);

  await fakeRedis.expire(key, 5);
  const validation = await service.validateHlsPlaybackTicket("live/repo-name/session-1", grant.ticketId);

  assert.equal(validation.ok, true);
  assert.equal(fakeRedis.getTtlSeconds(key), 600);
});

test("validateHlsPlaybackTicket rejects path mismatch and non-MediaMTX cache", async () => {
  fakeRedis.setJson("stream:recording:session-1", {
    repositoryId: "repo-1",
    repositoryName: "repo-name",
    userId: "publisher-1",
    ingestType: "HTTP",
    status: "STREAMING",
  } satisfies RecordingSessionLiveCache);

  const grant = await service.issueHlsPlaybackTicket({
    recordingSessionId: "session-1",
    repositoryId: "repo-1",
    userId: "viewer-1",
    streamPath: "live/repo-name/session-1",
  });

  assert.deepEqual(await service.validateHlsPlaybackTicket("live/other/session-1", grant.ticketId), {
    ok: false,
    reason: "playback-ticket-stream-path-mismatch",
    ticketId: grant.ticketId,
  });

  assert.deepEqual(await service.validateHlsPlaybackTicket("live/repo-name/session-1", grant.ticketId), {
    ok: false,
    reason: "live-cache-not-mediamtx",
    ticketId: grant.ticketId,
  });
});
