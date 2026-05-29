export const STREAM_RECONCILE_INTERVAL_MS = 5 * 1000;
export const FIRST_PUBLISH_DEADLINE_MS = 5 * 60 * 1000;

export const RECORDING_REGISTRATION_TTL_SECONDS = 5 * 60;
export const RECORDING_ACTIVE_TTL_SECONDS = 24 * 60 * 60;
export const RECORDING_FINALIZE_GRACE_PERIOD_MS = 30 * 1000;
export const RECORDING_FINALIZE_MAX_WAIT_MS = 2 * 60 * 1000;
export const SEGMENT_MAPPING_TTL_SECONDS = 24 * 60 * 60;
export const STREAM_ACTIVE_SET_KEY = "stream:active:sessions";
export const STREAM_CONNECTION_SCAN_PATTERN = "conn:*";

export const LIVE_PLAYBACK_AUTH_CACHE_TTL_SECONDS = 30;
export const LIVE_PLAYBACK_AUTH_CREDENTIAL_HASH_ALGORITHM = "sha256";
export const LIVE_PLAYBACK_AUTH_CACHE_ALLOW_VALUE = "1";

export enum LivePlaybackAuthCachePrefix {
  Hls = "hlsauth",
  Whep = "whepauth",
}
