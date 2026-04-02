import { runtimeConfig as env } from "../config/runtime";

export const buildBullConnection = () => {
  const url = new URL(env.REDIS_URL);
  const db = Number(url.pathname.replace("/", "") || "0");

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db,
    maxRetriesPerRequest: null,
  };
};
