export const ASSET_URL_PATTERN = /\/assets\/.*\.(js|css)(\?|$)/;
export const CHUNK_LOAD_MESSAGE_PATTERN =
	/(Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|Load failed)/i;
export const CHUNK_RECOVERY_THROTTLE_MS = 30_000;
