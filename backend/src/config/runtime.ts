import { fileConfig } from "./config.file";
import { env } from "./env";

const defaultDatabaseUrl = "postgresql://postgres:postgres@postgres:5432/egoflow?schema=public";
const defaultRedisUrl = "redis://redis:6379";

export const runtimeConfig = {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  TARGET_DIRECTORY: fileConfig.TARGET_DIRECTORY,
  PUBLIC_HTTP_PORT: fileConfig.PUBLIC_HTTP_PORT,
  RTMP_PORT: fileConfig.RTMP_PORT,
  HLS_PORT: fileConfig.HLS_PORT,
  MEDIAMTX_API_PORT: fileConfig.MEDIAMTX_API_PORT,
  CORS_ORIGIN: fileConfig.CORS_ORIGIN,
  WORKER_CONCURRENCY: fileConfig.WORKER_CONCURRENCY,
  DELETE_RAW_AFTER_PROCESSING: fileConfig.DELETE_RAW_AFTER_PROCESSING,
  JWT_EXPIRES_IN: fileConfig.JWT_EXPIRES_IN,
  JWT_REFRESH_THRESHOLD_SECONDS: fileConfig.JWT_REFRESH_THRESHOLD_SECONDS,
  ADMIN_DEFAULT_PASSWORD: env.ADMIN_DEFAULT_PASSWORD,
  JWT_SECRET: env.JWT_SECRET,
  DATABASE_URL: env.DATABASE_URL ?? defaultDatabaseUrl,
  REDIS_URL: env.REDIS_URL ?? defaultRedisUrl,
  HF_TOKEN: env.HF_TOKEN,
  RTMP_BASE_URL: env.PUBLIC_RTMP_BASE_URL ?? `rtmp://127.0.0.1:${fileConfig.RTMP_PORT}/live`,
  HLS_BASE_URL: env.PUBLIC_HLS_BASE_URL ?? `http://127.0.0.1:${fileConfig.HLS_PORT}`,
  MEDIAMTX_API_URL: env.MEDIAMTX_API_URL ?? `http://mediamtx:${fileConfig.MEDIAMTX_API_PORT}`,
} as const;
