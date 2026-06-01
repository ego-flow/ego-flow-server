export const STREAM_RECONCILE_INTERVAL_MS = 5 * 1000;

export const RECORDING_REGISTRATION_TTL_SECONDS = 5 * 60;
export const RECORDING_ACTIVE_TTL_SECONDS = 2 * 60 * 60;
export const STREAM_ACTIVE_SET_KEY = "stream:active:sessions";

export const LIVE_PLAYBACK_AUTH_CACHE_TTL_SECONDS = 30;
export const LIVE_PLAYBACK_AUTH_CREDENTIAL_HASH_ALGORITHM = "sha256";
export const LIVE_PLAYBACK_AUTH_CACHE_ALLOW_VALUE = "1";

export enum LivePlaybackAuthCachePrefix {
  Hls = "hlsauth",
}
