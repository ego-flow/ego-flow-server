import path from "path";

import { fileConfig } from "./config.file";
import { env } from "./env";

export const runtimeConfig = {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  DATA_ROOT: fileConfig.TARGET_DIRECTORY,
  TARGET_DIRECTORY: path.join(fileConfig.TARGET_DIRECTORY, "datasets"),
  PUBLIC_HTTP_PORT: fileConfig.PUBLIC_HTTP_PORT,
  RTMP_PORT: fileConfig.RTMP_PORT,
  RTMPS_PORT: fileConfig.RTMPS_PORT,
  HLS_PORT: fileConfig.HLS_PORT,
  MEDIAMTX_API_PORT: fileConfig.MEDIAMTX_API_PORT,
  CORS_ORIGIN: fileConfig.CORS_ORIGIN,
  WORKER_CONCURRENCY: fileConfig.WORKER_CONCURRENCY,
  DELETE_RAW_AFTER_PROCESSING: fileConfig.DELETE_RAW_AFTER_PROCESSING,
  JWT_EXPIRES_IN: fileConfig.JWT_EXPIRES_IN,
  JWT_REFRESH_THRESHOLD_SECONDS: fileConfig.JWT_REFRESH_THRESHOLD_SECONDS,
  ADMIN_DEFAULT_PASSWORD: env.ADMIN_DEFAULT_PASSWORD,
  JWT_SECRET: env.JWT_SECRET,
  DATABASE_URL: env.DATABASE_URL,
  REDIS_URL: env.REDIS_URL,
  HF_TOKEN: env.HF_TOKEN,
  RTMPS_ENCRYPTION_MODE: env.RTMPS_ENCRYPTION_MODE ?? "no",
  RTMPS_ENABLED: (env.RTMPS_ENCRYPTION_MODE ?? "no") !== "no",
  RTMPS_CERT_PATH: env.RTMPS_CERT_PATH ?? "/certs/server.crt",
  RTMPS_KEY_PATH: env.RTMPS_KEY_PATH ?? "/certs/server.key",
  RTMP_BASE_URL: env.PUBLIC_RTMP_BASE_URL ?? `rtmp://127.0.0.1:${fileConfig.RTMP_PORT}/live`,
  HLS_BASE_URL: env.PUBLIC_HLS_BASE_URL ?? `http://127.0.0.1:${fileConfig.HLS_PORT}`,
  MEDIAMTX_API_URL: env.MEDIAMTX_API_URL ?? `http://mediamtx:${fileConfig.MEDIAMTX_API_PORT}`,
} as const;
