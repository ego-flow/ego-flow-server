export const DEFAULT_CONFIG_FILE_NAME = "config.json";
export const FIXED_RAW_ROOT = "/data/raw";
export const TARGET_DIRECTORY_DATASETS_SUBDIRECTORY = "datasets";

export const DEFAULT_RTMPS_ENCRYPTION_MODE = "no";
export const DEFAULT_RTMPS_CERT_PATH = "/certs/server.crt";
export const DEFAULT_RTMPS_KEY_PATH = "/certs/server.key";
export const DEFAULT_WHIP_PATH_PREFIX = "/live";

export const FIXED_BACKEND_SERVICE_NAME = "backend";
export const FIXED_DASHBOARD_SERVICE_NAME = "dashboard";
export const FIXED_MEDIAMTX_SERVICE_NAME = "mediamtx";
export const FIXED_POSTGRES_SERVICE_NAME = "postgres";
export const FIXED_REDIS_SERVICE_NAME = "redis";

export const FIXED_BACKEND_INTERNAL_PORT = 3000;
export const FIXED_DASHBOARD_INTERNAL_PORT = 8088;
export const FIXED_POSTGRES_PORT = 5432;
export const FIXED_REDIS_PORT = 6379;
export const FIXED_PUBLIC_HTTP_PORT = 80;
export const FIXED_RTMP_PORT = 1935;
export const FIXED_RTMPS_PORT = 1936;
export const FIXED_HLS_PORT = 8888;
export const FIXED_WHIP_PORT = 8889;
export const FIXED_WEBRTC_UDP_PORT = 8189;
export const FIXED_MEDIAMTX_API_PORT = 9997;
export const FIXED_REDIS_URL = `redis://${FIXED_REDIS_SERVICE_NAME}:${FIXED_REDIS_PORT}`;
export const FIXED_MEDIAMTX_API_URL = `http://${FIXED_MEDIAMTX_SERVICE_NAME}:${FIXED_MEDIAMTX_API_PORT}`;
