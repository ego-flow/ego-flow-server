import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";
import type { UserRole } from "#/lib/auth-session";
import { authTokenPath } from "#/utils/api-paths";

export interface CurrentApiToken {
	id: string;
	name: string;
	lastUsedAt: string | null;
	createdAt: string;
}

export interface CreatedApiToken {
	id: string;
	name: string;
	token: string;
	createdAt: string;
	rotatedPrevious: boolean;
}

export interface AdminApiToken {
	id: string;
	userId: string;
	userRole: UserRole;
	displayName: string;
	name: string;
	lastUsedAt: string | null;
	createdAt: string;
}

export async function requestCreateToken(name: string) {
	const response = await apiClient.post<{
		id: string;
		name: string;
		token: string;
		created_at: string;
		rotated_previous: boolean;
	}>(ApiEndpoint.AuthPythonTokens, {
		name,
	});

	return {
		id: response.data.id,
		name: response.data.name,
		token: response.data.token,
		createdAt: response.data.created_at,
		rotatedPrevious: response.data.rotated_previous,
	} satisfies CreatedApiToken;
}

export async function requestCurrentToken() {
	const response = await apiClient.get<{
		token: {
			id: string;
			name: string;
			last_used_at: string | null;
			created_at: string;
		} | null;
	}>(ApiEndpoint.AuthPythonTokens);

	if (!response.data.token) {
		return {
			token: null,
		} as const;
	}

	return {
		token: {
			id: response.data.token.id,
			name: response.data.token.name,
			lastUsedAt: response.data.token.last_used_at,
			createdAt: response.data.token.created_at,
		} satisfies CurrentApiToken,
	} as const;
}

export async function requestAdminTokens() {
	const response = await apiClient.get<{
		tokens: Array<{
			id: string;
			user_id: string;
			user_role: UserRole;
			display_name: string;
			name: string;
			last_used_at: string | null;
			created_at: string;
		}>;
	}>(ApiEndpoint.AdminPythonTokens);

	return response.data.tokens.map((token) => ({
		id: token.id,
		userId: token.user_id,
		userRole: token.user_role,
		displayName: token.display_name,
		name: token.name,
		lastUsedAt: token.last_used_at,
		createdAt: token.created_at,
	})) satisfies AdminApiToken[];
}

export async function requestRevokeToken(tokenId: string) {
	const response = await apiClient.delete<{
		id: string;
		revoked: boolean;
	}>(authTokenPath(tokenId));

	return response.data;
}
