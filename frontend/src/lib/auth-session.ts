import type { UserRole } from "#/constants/auth/auth-constants";

export { UserRole } from "#/constants/auth/auth-constants";

export interface AuthUser {
	id: string;
	role: UserRole;
	displayName: string;
}

export interface AuthSession {
	user: AuthUser;
}
