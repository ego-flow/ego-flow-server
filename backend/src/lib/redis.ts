import Redis from "ioredis";

import { env } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __egoflowRedis: Redis | undefined;
}

const createRedisClient = () => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => {
      if (attempt > 3) {
        console.error("[redis] reconnect stopped after 3 attempts");
        return null;
      }
      return Math.min(attempt * 500, 2000);
    },
  });

  client.on("connect", () => {
    console.log("[redis] connected");
  });

  client.on("error", (error) => {
    console.error("[redis] error:", error.message);
  });

  client.on("end", () => {
    console.warn("[redis] disconnected");
  });

  return client;
};

export const redis = global.__egoflowRedis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  global.__egoflowRedis = redis;
}
