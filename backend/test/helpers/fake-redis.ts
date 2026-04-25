type RedisValue = string;

class FakeRedisMulti {
  private readonly commands: Array<() => Promise<unknown>> = [];

  constructor(private readonly redis: FakeRedis) {}

  set(key: string, value: RedisValue, ...args: Array<string | number>) {
    this.commands.push(() => this.redis.set(key, value, ...args));
    return this;
  }

  del(...keys: string[]) {
    this.commands.push(() => this.redis.del(...keys));
    return this;
  }

  expire(key: string, seconds: number) {
    this.commands.push(() => this.redis.expire(key, seconds));
    return this;
  }

  sadd(key: string, ...members: string[]) {
    this.commands.push(() => this.redis.sadd(key, ...members));
    return this;
  }

  srem(key: string, ...members: string[]) {
    this.commands.push(() => this.redis.srem(key, ...members));
    return this;
  }

  async exec() {
    const results: Array<[null, unknown]> = [];
    for (const command of this.commands) {
      results.push([null, await command()]);
    }
    return results;
  }
}

export class FakeRedis {
  private readonly store = new Map<string, RedisValue>();
  private readonly sets = new Map<string, Set<string>>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: RedisValue, ..._args: Array<string | number>) {
    this.store.set(key, String(value));
    return "OK";
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted += 1;
      }
    }
    return deleted;
  }

  async expire(key: string, _seconds: number) {
    return this.store.has(key) ? 1 : 0;
  }

  async mget(...keys: string[]) {
    return keys.map((key) => this.store.get(key) ?? null);
  }

  async sadd(key: string, ...members: string[]) {
    const bucket = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const member of members) {
      if (!bucket.has(member)) {
        bucket.add(member);
        added += 1;
      }
    }
    this.sets.set(key, bucket);
    return added;
  }

  async srem(key: string, ...members: string[]) {
    const bucket = this.sets.get(key);
    if (!bucket) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      if (bucket.delete(member)) {
        removed += 1;
      }
    }
    if (bucket.size === 0) {
      this.sets.delete(key);
    }
    return removed;
  }

  async smembers(key: string) {
    const bucket = this.sets.get(key);
    return bucket ? Array.from(bucket.values()) : [];
  }

  async scan(cursor: string, ...args: Array<string | number>) {
    const currentCursor = Number(cursor);
    const matchIndex = args.findIndex((value) => String(value).toUpperCase() === "MATCH");
    const countIndex = args.findIndex((value) => String(value).toUpperCase() === "COUNT");
    const pattern = matchIndex >= 0 ? String(args[matchIndex + 1] ?? "*") : "*";
    const count = countIndex >= 0 ? Number(args[countIndex + 1] ?? 10) : 10;
    const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
    const matched = Array.from(this.store.keys()).filter((key) => regex.test(key)).sort();
    const nextChunk = matched.slice(currentCursor, currentCursor + count);
    const nextCursor = currentCursor + count >= matched.length ? "0" : String(currentCursor + count);
    return [nextCursor, nextChunk];
  }

  multi() {
    return new FakeRedisMulti(this);
  }

  async eval(script: string, numKeys: number, ...args: Array<string | number>) {
    const keyCount = Number(numKeys);
    const keys = args.slice(0, keyCount).map(String);
    const argv = args.slice(keyCount).map(String);
    return this.runLuaScript(script, keys, argv);
  }

  clear() {
    this.store.clear();
    this.sets.clear();
  }

  has(key: string) {
    return this.store.has(key);
  }

  setJson(key: string, value: unknown) {
    this.store.set(key, JSON.stringify(value));
  }

  getJson<T>(key: string): T | null {
    const raw = this.store.get(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as T;
  }

  private runLuaScript(script: string, keys: string[], argv: string[]) {
    if (script.includes("releasedOwner")) {
      return this.runReleaseScript(keys, argv);
    }

    if (script.includes('owner["status"] = "publishing"')) {
      return this.runRefreshScript(keys, argv);
    }

    if (script.includes("generationKey") && script.includes("healthyWindowMs")) {
      return this.runClaimScript(keys, argv);
    }

    throw new Error("Unsupported Redis eval script in test double.");
  }

  private runClaimScript(keys: string[], argv: string[]) {
    const [ownerKey, generationKey] = keys;
    const [nowRaw, ttlSecRaw, _healthyWindowMsRaw, staleWindowMsRaw, streamId, recordingSessionId, connectionId, repositoryId, repositoryName, userId, streamPath] = argv;
    if (
      !ownerKey ||
      !generationKey ||
      !nowRaw ||
      !ttlSecRaw ||
      !staleWindowMsRaw ||
      !streamId ||
      !recordingSessionId ||
      !connectionId ||
      !repositoryId ||
      !repositoryName ||
      !userId ||
      !streamPath
    ) {
      throw new Error("Invalid claim script invocation in test double.");
    }

    const now = Number(nowRaw);
    const ttlSec = Number(ttlSecRaw);
    const staleWindowMs = Number(staleWindowMsRaw);

    const existing = this.getJson<Record<string, unknown>>(ownerKey);
    if (existing) {
      const leaseExpiresAt = Number(existing.leaseExpiresAt ?? 0);
      const lastHeartbeatAt = Number(existing.lastHeartbeatAt ?? 0);
      const status = String(existing.status ?? "");
      if (leaseExpiresAt > now) {
        if (status === "claimed") {
          return JSON.stringify({
            outcome: "rejected",
            existing,
          });
        }

        if (lastHeartbeatAt >= now - staleWindowMs) {
          return JSON.stringify({
            outcome: "rejected",
            existing,
          });
        }
      }
    }

    const previousGeneration = Number(this.store.get(generationKey) ?? "0");
    const generation = previousGeneration + 1;
    const leaseExpiresAt = now + ttlSec * 1000;
    const outcome = existing ? "takeover" : "claimed";
    const owner = {
      streamId,
      recordingSessionId,
      connectionId,
      generation,
      status: "claimed",
      repositoryId,
      repositoryName,
      userId,
      streamPath,
      lastHeartbeatAt: now,
      leaseExpiresAt,
    };

    this.store.set(generationKey, String(generation));
    this.setJson(ownerKey, owner);

    return JSON.stringify({
      outcome,
      owner,
    });
  }

  private runRefreshScript(keys: string[], argv: string[]) {
    const [ownerKey, connectionKey] = keys;
    const [nowRaw, ttlSecRaw, streamId, recordingSessionId, connectionId, generationRaw, sourceId = "", sourceType = ""] = argv;
    if (!ownerKey || !connectionKey || !nowRaw || !ttlSecRaw || !streamId || !recordingSessionId || !connectionId || !generationRaw) {
      throw new Error("Invalid refresh script invocation in test double.");
    }

    const now = Number(nowRaw);
    const ttlSec = Number(ttlSecRaw);
    const generation = Number(generationRaw);

    const owner = this.getJson<Record<string, unknown>>(ownerKey);
    if (!owner) {
      return JSON.stringify({
        outcome: "rejected",
        reason: "owner-missing",
      });
    }

    const connection = this.getJson<Record<string, unknown>>(connectionKey);
    if (!connection) {
      return JSON.stringify({
        outcome: "rejected",
        reason: "connection-missing",
      });
    }

    const ownerMatches =
      owner.streamId === streamId &&
      owner.recordingSessionId === recordingSessionId &&
      owner.connectionId === connectionId &&
      Number(owner.generation) === generation;
    const connectionMatches =
      connection.streamId === streamId &&
      connection.recordingSessionId === recordingSessionId &&
      connection.connectionId === connectionId &&
      Number(connection.generation) === generation;

    if (!ownerMatches || !connectionMatches) {
      return JSON.stringify({
        outcome: "rejected",
        reason: "generation-mismatch",
        owner,
        connection,
      });
    }

    const leaseExpiresAt = now + ttlSec * 1000;
    const nextOwner = {
      ...owner,
      status: "publishing",
      lastHeartbeatAt: now,
      leaseExpiresAt,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceType ? { sourceType } : {}),
    };
    const nextConnection = {
      ...connection,
      status: "publishing",
      lastHeartbeatAt: now,
      leaseExpiresAt,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceType ? { sourceType } : {}),
    };

    this.setJson(ownerKey, nextOwner);
    this.setJson(connectionKey, nextConnection);

    return JSON.stringify({
      outcome: "refreshed",
      owner: nextOwner,
      connection: nextConnection,
    });
  }

  private runReleaseScript(keys: string[], argv: string[]) {
    const [ownerKey, connectionKey] = keys;
    const [streamId, recordingSessionId, connectionId, generationRaw] = argv;
    if (!ownerKey || !connectionKey || !streamId || !recordingSessionId || !connectionId || !generationRaw) {
      throw new Error("Invalid release script invocation in test double.");
    }

    const generation = Number(generationRaw);

    const owner = this.getJson<Record<string, unknown>>(ownerKey);
    const connection = this.getJson<Record<string, unknown>>(connectionKey);

    if (!owner && !connection) {
      return JSON.stringify({
        outcome: "rejected",
        reason: "ownership-missing",
      });
    }

    const ownerMatches =
      owner &&
      owner.streamId === streamId &&
      owner.recordingSessionId === recordingSessionId &&
      owner.connectionId === connectionId &&
      Number(owner.generation) === generation;
    const connectionMatches =
      connection &&
      connection.streamId === streamId &&
      connection.recordingSessionId === recordingSessionId &&
      connection.connectionId === connectionId &&
      Number(connection.generation) === generation;

    if ((owner && !ownerMatches) || (connection && !connectionMatches)) {
      return JSON.stringify({
        outcome: "rejected",
        reason: "generation-mismatch",
        owner,
        connection,
      });
    }

    if (ownerMatches) {
      this.store.delete(ownerKey);
    }

    if (connectionMatches) {
      this.store.delete(connectionKey);
    }

    return JSON.stringify({
      outcome: "released",
      releasedOwner: Boolean(ownerMatches),
      releasedConnection: Boolean(connectionMatches),
    });
  }
}
