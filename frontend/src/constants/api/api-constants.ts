export const DEFAULT_API_BASE_URL = "/api/v1";
export const DEFAULT_BACKEND_ORIGIN = "http://127.0.0.1";
export const API_JSON_CONTENT_TYPE = "application/json";

export enum ApiEndpoint {
	AdminDashboardUsers = "/admin/dashboard/users",
	AdminPythonTokens = "/admin/python/tokens",
	AdminSettings = "/admin/settings",
	AdminUsers = "/admin/users",
	AuthDashboardLogin = "/auth/dashboard/login",
	AuthDashboardLogout = "/auth/dashboard/logout",
	AuthDashboardSession = "/auth/dashboard/session",
	AuthPythonTokens = "/auth/python/tokens",
	LiveStreams = "/live-streams",
	Repositories = "/repositories",
	RepositoriesMine = "/repositories/mine",
	UsersMePassword = "/users/me/password",
}
