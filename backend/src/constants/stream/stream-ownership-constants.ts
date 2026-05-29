export const INITIAL_OWNER_LEASE_TTL_SECONDS = 60;
export const STEADY_OWNER_LEASE_TTL_SECONDS = 30;
export const HEARTBEAT_INTERVAL_SECONDS = 5;
export const PUBLISH_TICKET_TTL_SECONDS = 60;
export const OWNER_HEALTHY_HEARTBEAT_WINDOW_MS = 10 * 1000;
export const OWNER_STALE_HEARTBEAT_WINDOW_MS = 15 * 1000;

export const CLAIM_OWNER_SCRIPT = `
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

export const REFRESH_OWNER_SCRIPT = `
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

export const RELEASE_OWNER_SCRIPT = `
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
