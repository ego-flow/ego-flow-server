import { v4 as uuidv4 } from "uuid";

import { redis } from "../lib/redis";
import type {
  PublishTicketRecord,
  StreamConnectionMetadata,
  StreamOwnerLease,
} from "../types/stream";

const INITIAL_OWNER_LEASE_TTL_SECONDS = 60;
const STEADY_OWNER_LEASE_TTL_SECONDS = 30;
const HEARTBEAT_INTERVAL_SECONDS = 5;
const PUBLISH_TICKET_TTL_SECONDS = 60;
const OWNER_HEALTHY_HEARTBEAT_WINDOW_MS = 10 * 1000;
const OWNER_STALE_HEARTBEAT_WINDOW_MS = 15 * 1000;

const streamTicketKey = (ticketId: string) => `stream:ticket:${ticketId}`;
const activeTicketKey = (recordingSessionId: string) => `stream:recording:${recordingSessionId}:ticket:active`;
const streamOwnerKey = (streamId: string) => `stream:${streamId}:owner`;
const streamOwnerGenerationKey = (streamId: string) => `stream:${streamId}:generation`;
const streamConnectionKey = (connectionId: string) => `conn:${connectionId}`;

const CLAIM_OWNER_SCRIPT = `
local ownerKey = KEYS[1]
local generationKey = KEYS[2]
local now = tonumber(ARGV[1])
local ttlSec = tonumber(ARGV[2])
local healthyWindowMs = tonumber(ARGV[3])
local staleWindowMs = tonumber(ARGV[4])
local streamId = ARGV[5]
local recordingSessionId = ARGV[6]
local connectionId = ARGV[7]
local repositoryId = ARGV[8]
local repositoryName = ARGV[9]
local userId = ARGV[10]
local streamPath = ARGV[11]

local existingRaw = redis.call("GET", ownerKey)
local outcome = "claimed"

if existingRaw then
  local ok, existing = pcall(cjson.decode, existingRaw)
  local leaseExpiresAt = ok and existing and tonumber(existing["leaseExpiresAt"]) or 0
  local lastHeartbeatAt = ok and existing and tonumber(existing["lastHeartbeatAt"]) or 0
  local status = ok and existing and tostring(existing["status"]) or ""
  if ok and existing and leaseExpiresAt > now then
    if status == "claimed" then
      return cjson.encode({
        outcome = "rejected",
        existing = existing
      })
    end

    if lastHeartbeatAt >= (now - staleWindowMs) then
      return cjson.encode({
        outcome = "rejected",
        existing = existing
      })
    end
  end

  if ok and existing then
    outcome = "takeover"
  end
end

local generation = tonumber(redis.call("INCR", generationKey))
local leaseExpiresAt = now + (ttlSec * 1000)
local owner = {
  streamId = streamId,
  recordingSessionId = recordingSessionId,
  connectionId = connectionId,
  generation = generation,
  status = "claimed",
  repositoryId = repositoryId,
  repositoryName = repositoryName,
  userId = userId,
  streamPath = streamPath,
  lastHeartbeatAt = now,
  leaseExpiresAt = leaseExpiresAt
}

redis.call("SET", ownerKey, cjson.encode(owner), "EX", ttlSec)

return cjson.encode({
  outcome = outcome,
  owner = owner
})
`;

const REFRESH_OWNER_SCRIPT = `
local ownerKey = KEYS[1]
local connectionKey = KEYS[2]
local now = tonumber(ARGV[1])
local ttlSec = tonumber(ARGV[2])
local streamId = ARGV[3]
local recordingSessionId = ARGV[4]
local connectionId = ARGV[5]
local generation = tonumber(ARGV[6])
local sourceId = ARGV[7]
local sourceType = ARGV[8]

local ownerRaw = redis.call("GET", ownerKey)
if not ownerRaw then
  return cjson.encode({
    outcome = "rejected",
    reason = "owner-missing"
  })
end

local connectionRaw = redis.call("GET", connectionKey)
if not connectionRaw then
  return cjson.encode({
    outcome = "rejected",
    reason = "connection-missing"
  })
end

local ownerOk, owner = pcall(cjson.decode, ownerRaw)
if not ownerOk or not owner then
  return cjson.encode({
    outcome = "rejected",
    reason = "malformed-owner-record"
  })
end

local connectionOk, connection = pcall(cjson.decode, connectionRaw)
if not connectionOk or not connection then
  return cjson.encode({
    outcome = "rejected",
    reason = "malformed-connection-record"
  })
end

if owner["streamId"] ~= streamId or owner["recordingSessionId"] ~= recordingSessionId or owner["connectionId"] ~= connectionId or tonumber(owner["generation"]) ~= generation then
  return cjson.encode({
    outcome = "rejected",
    reason = "generation-mismatch",
    owner = owner,
    connection = connection
  })
end

if connection["streamId"] ~= streamId or connection["recordingSessionId"] ~= recordingSessionId or connection["connectionId"] ~= connectionId or tonumber(connection["generation"]) ~= generation then
  return cjson.encode({
    outcome = "rejected",
    reason = "generation-mismatch",
    owner = owner,
    connection = connection
  })
end

local leaseExpiresAt = now + (ttlSec * 1000)
owner["status"] = "publishing"
owner["lastHeartbeatAt"] = now
owner["leaseExpiresAt"] = leaseExpiresAt
if sourceId ~= "" then
  owner["sourceId"] = sourceId
end
if sourceType ~= "" then
  owner["sourceType"] = sourceType
end

connection["status"] = "publishing"
connection["lastHeartbeatAt"] = now
connection["leaseExpiresAt"] = leaseExpiresAt
if sourceId ~= "" then
  connection["sourceId"] = sourceId
end
if sourceType ~= "" then
  connection["sourceType"] = sourceType
end

redis.call("SET", ownerKey, cjson.encode(owner), "EX", ttlSec)
redis.call("SET", connectionKey, cjson.encode(connection), "EX", ttlSec)

return cjson.encode({
  outcome = "refreshed",
  owner = owner,
  connection = connection
})
`;

const RELEASE_OWNER_SCRIPT = `
local ownerKey = KEYS[1]
local connectionKey = KEYS[2]
local streamId = ARGV[1]
local recordingSessionId = ARGV[2]
local connectionId = ARGV[3]
local generation = tonumber(ARGV[4])

local ownerRaw = redis.call("GET", ownerKey)
local connectionRaw = redis.call("GET", connectionKey)

if not ownerRaw and not connectionRaw then
  return cjson.encode({
    outcome = "rejected",
    reason = "ownership-missing"
  })
end

local owner = nil
if ownerRaw then
  local ownerOk, decodedOwner = pcall(cjson.decode, ownerRaw)
  if not ownerOk or not decodedOwner then
    return cjson.encode({
      outcome = "rejected",
      reason = "malformed-owner-record"
    })
  end
  owner = decodedOwner
end

local connection = nil
if connectionRaw then
  local connectionOk, decodedConnection = pcall(cjson.decode, connectionRaw)
  if not connectionOk or not decodedConnection then
    return cjson.encode({
      outcome = "rejected",
      reason = "malformed-connection-record"
    })
  end
  connection = decodedConnection
end

local ownerMatches = owner and owner["streamId"] == streamId and owner["recordingSessionId"] == recordingSessionId and owner["connectionId"] == connectionId and tonumber(owner["generation"]) == generation
local connectionMatches = connection and connection["streamId"] == streamId and connection["recordingSessionId"] == recordingSessionId and connection["connectionId"] == connectionId and tonumber(connection["generation"]) == generation

if owner and not ownerMatches then
  return cjson.encode({
    outcome = "rejected",
    reason = "generation-mismatch",
    owner = owner,
    connection = connection
  })
end

if connection and not connectionMatches then
  return cjson.encode({
    outcome = "rejected",
    reason = "generation-mismatch",
    owner = owner,
    connection = connection
  })
end

if ownerMatches then
  redis.call("DEL", ownerKey)
end

if connectionMatches then
  redis.call("DEL", connectionKey)
end

return cjson.encode({
  outcome = "released",
  releasedOwner = ownerMatches and true or false,
  releasedConnection = connectionMatches and true or false
})
`;

type OwnerClaimResult =
  | {
      outcome: "claimed" | "takeover";
      owner: StreamOwnerLease;
    }
  | {
      outcome: "rejected";
      existing: StreamOwnerLease;
    };

type PublishTicketValidationResult =
  | {
      ok: true;
      ticket: PublishTicketRecord;
      ticketId: string;
      owner: StreamOwnerLease;
      connection: StreamConnectionMetadata;
    }
  | {
      ok: false;
      reason: string;
      ticketId: string | null;
    };

type PublishTicketConsumeResult =
  | {
      ok: true;
      ticket: PublishTicketRecord;
    }
  | {
      ok: false;
      reason: string;
      ticketId: string | null;
    };

type OwnerRefreshResult =
  | {
      outcome: "refreshed";
      owner: StreamOwnerLease;
      connection: StreamConnectionMetadata;
    }
  | {
      outcome: "rejected";
      reason: string;
      owner?: StreamOwnerLease;
      connection?: StreamConnectionMetadata;
    };

type OwnerReleaseResult =
  | {
      outcome: "released";
      releasedOwner: boolean;
      releasedConnection: boolean;
    }
  | {
      outcome: "rejected";
      reason: string;
      owner?: StreamOwnerLease;
      connection?: StreamConnectionMetadata;
    };

export class StreamOwnershipService {
  buildStreamId(repositoryId: string) {
    return `repository:${repositoryId}`;
  }

  getPublishTicketTtlSeconds() {
    return PUBLISH_TICKET_TTL_SECONDS;
  }

  getOwnerLeaseTtlSeconds() {
    return INITIAL_OWNER_LEASE_TTL_SECONDS;
  }

  getSteadyOwnerLeaseTtlSeconds() {
    return STEADY_OWNER_LEASE_TTL_SECONDS;
  }

  getHeartbeatIntervalSeconds() {
    return HEARTBEAT_INTERVAL_SECONDS;
  }

  getHealthyHeartbeatWindowMs() {
    return OWNER_HEALTHY_HEARTBEAT_WINDOW_MS;
  }

  getStaleHeartbeatWindowMs() {
    return OWNER_STALE_HEARTBEAT_WINDOW_MS;
  }

  getPublishBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/+$/, "");
  }

  buildPublishUrl(baseUrl: string, repositoryName: string, publishTicket: string) {
    const normalizedBaseUrl = this.getPublishBaseUrl(baseUrl);
    return `${normalizedBaseUrl}/${repositoryName}?ticket=${encodeURIComponent(publishTicket)}`;
  }

  isHealthyOwner(owner: StreamOwnerLease, now = Date.now()) {
    if (owner.leaseExpiresAt <= now) {
      return false;
    }

    if (owner.status === "claimed") {
      return true;
    }

    return owner.lastHeartbeatAt >= now - OWNER_HEALTHY_HEARTBEAT_WINDOW_MS;
  }

  isStaleOwner(owner: StreamOwnerLease, now = Date.now()) {
    if (owner.leaseExpiresAt <= now) {
      return true;
    }

    if (owner.status === "claimed") {
      return false;
    }

    return owner.lastHeartbeatAt < now - OWNER_STALE_HEARTBEAT_WINDOW_MS;
  }

  async issuePublishTicket(params: {
    recordingSessionId: string;
    repositoryId: string;
    repositoryName: string;
    userId: string;
    streamPath: string;
  }): Promise<{
    ticket: PublishTicketRecord;
    owner: StreamOwnerLease;
    connection: StreamConnectionMetadata;
    ownerOutcome: "claimed" | "takeover";
    revokedTicket: PublishTicketRecord | null;
  }> {
    const now = Date.now();
    const streamId = this.buildStreamId(params.repositoryId);
    const ticketId = `t_${uuidv4()}`;
    const connectionId = `conn_${uuidv4()}`;

    const claimResult = await this.claimOwner({
      streamId,
      recordingSessionId: params.recordingSessionId,
      connectionId,
      repositoryId: params.repositoryId,
      repositoryName: params.repositoryName,
      userId: params.userId,
      streamPath: params.streamPath,
      now,
    });

    if (claimResult.outcome === "rejected") {
      return Promise.reject(claimResult);
    }

    const revokedTicket = await this.revokeActiveTicket(params.recordingSessionId);

    const expiresAt = now + PUBLISH_TICKET_TTL_SECONDS * 1000;
    const ticket: PublishTicketRecord = {
      ticketId,
      streamId,
      recordingSessionId: params.recordingSessionId,
      connectionId,
      generation: claimResult.owner.generation,
      repositoryId: params.repositoryId,
      repositoryName: params.repositoryName,
      userId: params.userId,
      streamPath: params.streamPath,
      issuedAt: now,
      expiresAt,
      status: "active",
    };

    const connection: StreamConnectionMetadata = {
      streamId,
      recordingSessionId: params.recordingSessionId,
      connectionId,
      generation: claimResult.owner.generation,
      repositoryId: params.repositoryId,
      repositoryName: params.repositoryName,
      userId: params.userId,
      streamPath: params.streamPath,
      status: "claimed",
      createdAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: claimResult.owner.leaseExpiresAt,
    };

    await redis
      .multi()
      .set(streamTicketKey(ticketId), JSON.stringify(ticket), "EX", PUBLISH_TICKET_TTL_SECONDS)
      .set(streamConnectionKey(connectionId), JSON.stringify(connection), "EX", INITIAL_OWNER_LEASE_TTL_SECONDS)
      .set(activeTicketKey(params.recordingSessionId), ticketId, "EX", PUBLISH_TICKET_TTL_SECONDS)
      .exec();

    return {
      ticket,
      owner: claimResult.owner,
      connection,
      ownerOutcome: claimResult.outcome,
      revokedTicket,
    };
  }

  async validatePublishTicket(streamPath: string, query?: string): Promise<PublishTicketValidationResult> {
    const ticketId = this.extractTicketId(query);
    if (!ticketId) {
      return {
        ok: false,
        reason: "missing-publish-ticket",
        ticketId: null,
      };
    }

    const raw = await redis.get(streamTicketKey(ticketId));
    if (!raw) {
      return {
        ok: false,
        reason: "unknown-or-expired-ticket",
        ticketId,
      };
    }

    let ticket: PublishTicketRecord;
    try {
      ticket = JSON.parse(raw) as PublishTicketRecord;
    } catch (_error) {
      return {
        ok: false,
        reason: "malformed-ticket-record",
        ticketId,
      };
    }

    if (ticket.status !== "active") {
      return {
        ok: false,
        reason: `ticket-status-${ticket.status.toLowerCase()}`,
        ticketId,
      };
    }

    if (ticket.expiresAt <= Date.now()) {
      return {
        ok: false,
        reason: "ticket-expired",
        ticketId,
      };
    }

    if (ticket.streamPath !== streamPath) {
      return {
        ok: false,
        reason: "ticket-stream-path-mismatch",
        ticketId,
      };
    }

    const ownerValidation = await this.validateCurrentOwner(ticket);
    if (!ownerValidation.ok) {
      return {
        ok: false,
        reason: ownerValidation.reason,
        ticketId,
      };
    }

    return {
      ok: true,
      ticket,
      ticketId,
      owner: ownerValidation.owner,
      connection: ownerValidation.connection,
    };
  }

  async consumePublishTicket(streamPath: string, query?: string): Promise<PublishTicketConsumeResult> {
    const validation = await this.validatePublishTicket(streamPath, query);
    if (!validation.ok) {
      return validation;
    }

    const remainingTtlSeconds = this.calculateRemainingTtlSeconds(validation.ticket.expiresAt);
    const nextTicket: PublishTicketRecord = {
      ...validation.ticket,
      status: "consumed",
    };

    await redis
      .multi()
      .set(streamTicketKey(validation.ticket.ticketId), JSON.stringify(nextTicket), "EX", remainingTtlSeconds)
      .del(activeTicketKey(validation.ticket.recordingSessionId))
      .exec();

    return {
      ok: true,
      ticket: nextTicket,
    };
  }

  async refreshConnectionLease(params: {
    repositoryId: string;
    recordingSessionId: string;
    connectionId: string;
    generation: number;
    sourceId?: string;
    sourceType?: string;
  }): Promise<OwnerRefreshResult> {
    const rawResult = await redis.eval(
      REFRESH_OWNER_SCRIPT,
      2,
      streamOwnerKey(this.buildStreamId(params.repositoryId)),
      streamConnectionKey(params.connectionId),
      Date.now().toString(),
      STEADY_OWNER_LEASE_TTL_SECONDS.toString(),
      this.buildStreamId(params.repositoryId),
      params.recordingSessionId,
      params.connectionId,
      params.generation.toString(),
      params.sourceId ?? "",
      params.sourceType ?? "",
    );

    return JSON.parse(String(rawResult)) as OwnerRefreshResult;
  }

  async releaseConnectionLease(params: {
    repositoryId: string;
    recordingSessionId: string;
    connectionId: string;
    generation: number;
  }): Promise<OwnerReleaseResult> {
    const rawResult = await redis.eval(
      RELEASE_OWNER_SCRIPT,
      2,
      streamOwnerKey(this.buildStreamId(params.repositoryId)),
      streamConnectionKey(params.connectionId),
      this.buildStreamId(params.repositoryId),
      params.recordingSessionId,
      params.connectionId,
      params.generation.toString(),
    );

    return JSON.parse(String(rawResult)) as OwnerReleaseResult;
  }

  async getCurrentOwner(streamId: string): Promise<StreamOwnerLease | null> {
    return this.parseRedisRecord(await redis.get(streamOwnerKey(streamId)));
  }

  async getCurrentOwnerForRepository(repositoryId: string): Promise<StreamOwnerLease | null> {
    return this.getCurrentOwner(this.buildStreamId(repositoryId));
  }

  async getConnection(connectionId: string): Promise<StreamConnectionMetadata | null> {
    return this.parseRedisRecord(await redis.get(streamConnectionKey(connectionId)));
  }

  async listConnections(): Promise<StreamConnectionMetadata[]> {
    const connections: StreamConnectionMetadata[] = [];
    let cursor = "0";

    do {
      const result = await redis.scan(cursor, "MATCH", "conn:*", "COUNT", 100);
      cursor = Array.isArray(result) ? String(result[0]) : "0";
      const keys = Array.isArray(result) && Array.isArray(result[1]) ? result[1] : [];

      if (keys.length > 0) {
        const values = await redis.mget(...keys);
        for (const raw of values) {
          const parsed = this.parseRedisRecord<StreamConnectionMetadata>(raw);
          if (parsed) {
            connections.push(parsed);
          }
        }
      }
    } while (cursor !== "0");

    return connections;
  }

  extractTicketId(query?: string) {
    const queryParams = new URLSearchParams(query ?? "");
    const ticketId = queryParams.get("ticket");
    return ticketId && ticketId.trim() ? ticketId.trim() : null;
  }

  private async claimOwner(params: {
    streamId: string;
    recordingSessionId: string;
    connectionId: string;
    repositoryId: string;
    repositoryName: string;
    userId: string;
    streamPath: string;
    now: number;
  }): Promise<OwnerClaimResult> {
    const rawResult = await redis.eval(
      CLAIM_OWNER_SCRIPT,
      2,
      streamOwnerKey(params.streamId),
      streamOwnerGenerationKey(params.streamId),
      params.now.toString(),
      INITIAL_OWNER_LEASE_TTL_SECONDS.toString(),
      OWNER_HEALTHY_HEARTBEAT_WINDOW_MS.toString(),
      OWNER_STALE_HEARTBEAT_WINDOW_MS.toString(),
      params.streamId,
      params.recordingSessionId,
      params.connectionId,
      params.repositoryId,
      params.repositoryName,
      params.userId,
      params.streamPath,
    );

    return JSON.parse(String(rawResult)) as OwnerClaimResult;
  }

  private async revokeActiveTicket(recordingSessionId: string): Promise<PublishTicketRecord | null> {
    const currentTicketId = await redis.get(activeTicketKey(recordingSessionId));
    if (!currentTicketId) {
      return null;
    }

    const raw = await redis.get(streamTicketKey(currentTicketId));
    if (!raw) {
      await redis.del(activeTicketKey(recordingSessionId));
      return null;
    }

    let existingTicket: PublishTicketRecord;
    try {
      existingTicket = JSON.parse(raw) as PublishTicketRecord;
    } catch (_error) {
      await redis
        .multi()
        .del(streamTicketKey(currentTicketId))
        .del(activeTicketKey(recordingSessionId))
        .exec();
      return null;
    }

    const remainingTtlSeconds = this.calculateRemainingTtlSeconds(existingTicket.expiresAt);
    const revokedTicket: PublishTicketRecord = {
      ...existingTicket,
      status: "revoked",
    };

    await redis
      .multi()
      .set(streamTicketKey(currentTicketId), JSON.stringify(revokedTicket), "EX", remainingTtlSeconds)
      .del(activeTicketKey(recordingSessionId))
      .exec();

    return revokedTicket;
  }

  private async validateCurrentOwner(ticket: PublishTicketRecord): Promise<
    | {
        ok: true;
        owner: StreamOwnerLease;
        connection: StreamConnectionMetadata;
      }
    | {
        ok: false;
        reason: string;
      }
  > {
    const now = Date.now();

    const ownerRaw = await redis.get(streamOwnerKey(ticket.streamId));
    if (!ownerRaw) {
      return {
        ok: false,
        reason: "owner-lease-missing",
      };
    }

    let owner: StreamOwnerLease;
    try {
      owner = JSON.parse(ownerRaw) as StreamOwnerLease;
    } catch (_error) {
      return {
        ok: false,
        reason: "malformed-owner-record",
      };
    }

    if (owner.leaseExpiresAt <= now) {
      return {
        ok: false,
        reason: "owner-lease-expired",
      };
    }

    if (
      owner.recordingSessionId !== ticket.recordingSessionId ||
      owner.connectionId !== ticket.connectionId ||
      owner.generation !== ticket.generation ||
      owner.repositoryId !== ticket.repositoryId ||
      owner.repositoryName !== ticket.repositoryName ||
      owner.userId !== ticket.userId ||
      owner.streamPath !== ticket.streamPath
    ) {
      return {
        ok: false,
        reason: "owner-ticket-mismatch",
      };
    }

    const connectionRaw = await redis.get(streamConnectionKey(ticket.connectionId));
    if (!connectionRaw) {
      return {
        ok: false,
        reason: "connection-metadata-missing",
      };
    }

    let connection: StreamConnectionMetadata;
    try {
      connection = JSON.parse(connectionRaw) as StreamConnectionMetadata;
    } catch (_error) {
      return {
        ok: false,
        reason: "malformed-connection-record",
      };
    }

    if (connection.leaseExpiresAt <= now) {
      return {
        ok: false,
        reason: "connection-lease-expired",
      };
    }

    if (
      connection.streamId !== ticket.streamId ||
      connection.recordingSessionId !== ticket.recordingSessionId ||
      connection.connectionId !== ticket.connectionId ||
      connection.generation !== ticket.generation ||
      connection.repositoryId !== ticket.repositoryId ||
      connection.repositoryName !== ticket.repositoryName ||
      connection.userId !== ticket.userId ||
      connection.streamPath !== ticket.streamPath
    ) {
      return {
        ok: false,
        reason: "connection-ticket-mismatch",
      };
    }

    return {
      ok: true,
      owner,
      connection,
    };
  }

  private parseRedisRecord<T>(raw: string | null): T | null {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (_error) {
      return null;
    }
  }

  private calculateRemainingTtlSeconds(expiresAt: number) {
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  }
}

export const streamOwnershipService = new StreamOwnershipService();
