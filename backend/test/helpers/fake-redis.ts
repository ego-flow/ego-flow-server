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
}
