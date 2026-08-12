export enum AuthCredentialKind {
  Dashboard = "dashboard",
  App = "app",
  Python = "python",
}

export enum HttpAuthScheme {
  Bearer = "Bearer",
}

export const PYTHON_TOKEN_PREFIX = "ef_";
export const PYTHON_TOKEN_RANDOM_BYTES = 20;
export const PYTHON_TOKEN_HASH_ALGORITHM = "sha256";
export const PYTHON_TOKEN_LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

export const DASHBOARD_SESSION_COOKIE_NAME = "egoflow_session";
export const DASHBOARD_SESSION_TOKEN_PREFIX = "efs_";
export const DASHBOARD_SESSION_RANDOM_BYTES = 32;
export const DASHBOARD_SESSION_HASH_ALGORITHM = "sha256";
export const DASHBOARD_SESSION_SHORT_TTL_MS = 12 * 60 * 60 * 1000;
export const DASHBOARD_SESSION_REMEMBERED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DASHBOARD_SESSION_LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
export const DASHBOARD_SESSION_KEY_PREFIX = "dashboard:session:";
