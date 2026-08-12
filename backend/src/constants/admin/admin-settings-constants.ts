export const ADMIN_SETTINGS_SECTION_TITLE = {
  ConfigFile: "config.json",
  Ports: "Ports",
  Dotenv: ".env",
} as const;

export const ADMIN_SETTINGS_SECTION_DESCRIPTION = {
  ConfigFile: "Values loaded from config.json.",
  Ports: "Stack port map.",
  Dotenv: "Values loaded from .env. Secret values are masked.",
} as const;

export const ADMIN_CONFIG_SETTING_KEY = {
  TargetDirectory: "TARGET_DIRECTORY",
  CorsOrigin: "CORS_ORIGIN",
  WorkerConcurrency: "WORKER_CONCURRENCY",
  DeleteRawAfterProcessing: "DELETE_RAW_AFTER_PROCESSING",
  JwtExpiresIn: "JWT_EXPIRES_IN",
  JwtRefreshThresholdSeconds: "JWT_REFRESH_THRESHOLD_SECONDS",
  SignedFileUrlExpiresIn: "SIGNED_FILE_URL_EXPIRES_IN",
} as const;

export const ADMIN_ENV_SETTING_KEY = {
  NodeEnv: "NODE_ENV",
  Port: "PORT",
  DatabaseUrl: "DATABASE_URL",
  JwtSecret: "JWT_SECRET",
  AdminDefaultPassword: "ADMIN_DEFAULT_PASSWORD",
  HfToken: "HF_TOKEN",
  RtmpsEncryptionMode: "RTMPS_ENCRYPTION_MODE",
  RtmpsCertPath: "RTMPS_CERT_PATH",
  RtmpsKeyPath: "RTMPS_KEY_PATH",
} as const;

export const ADMIN_PORT_GROUP_KEY = {
  InternalOnly: "internal-only",
} as const;

export const ADMIN_PORT_LABEL = {
  PublicHttp: "Dashboard, API, WHIP routing",
  BackendApi: "Backend API",
  DashboardUi: "Dashboard UI",
  WhipSignaling: "WHIP signaling",
  RtmpIngest: "RTMP ingest",
  RtmpsIngest: "RTMPS ingest",
  HlsPlayback: "HLS playback",
  WebRtcMedia: "WebRTC media",
  DockerNetworkOnly: "Docker network only",
  MediaMtxControlApi: "MediaMTX control API",
  Postgres: "PostgreSQL",
  RedisBullMq: "Redis, BullMQ",
} as const;
