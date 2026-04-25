import { apiClient } from "#/api/client";
import type { UserRole } from "#/lib/auth-session";

export interface AdminUser {
	id: string;
	role: UserRole;
	displayName: string | null;
	createdAt: string;
	isActive: boolean;
}

export interface AdminSettings {
	targetDirectory: string | null;
}

export interface AdminUserDeleteReadiness {
	userId: string;
	canDelete: boolean;
	checks: {
		isDeactivated: boolean;
		ownedRepositoryCount: number;
		repositoryMembershipCount: number;
		recordingSessionCount: number;
	};
}

export async function requestAdminUsers() {
	const response = await apiClient.get<{
		users: Array<{
			id: string;
			role: UserRole;
			displayName: string | null;
			createdAt: string;
			is_active: boolean;
		}>;
	}>("/admin/users");

	return response.data.users.map((user) => ({
		id: user.id,
		role: user.role,
		displayName: user.displayName,
		createdAt: user.createdAt,
		isActive: user.is_active,
	})) satisfies AdminUser[];
}

export async function requestCreateUser(input: {
	id: string;
	password: string;
	displayName: string;
}) {
	const response = await apiClient.post("/admin/users", {
		id: input.id,
		password: input.password,
		displayName: input.displayName || undefined,
	});

	return response.data;
}

export async function requestResetUserPassword(
	userId: string,
	newPassword: string,
) {
	const response = await apiClient.put(
		`/admin/users/${encodeURIComponent(userId)}/reset-password`,
		{
			newPassword,
		},
	);

	return response.data;
}

export async function requestDeactivateUser(userId: string) {
	const response = await apiClient.delete(
		`/admin/users/${encodeURIComponent(userId)}`,
	);
	return response.data;
}

export async function requestUserDeleteReadiness(userId: string) {
	const response = await apiClient.get<{
		user_id: string;
		can_delete: boolean;
		checks: {
			is_deactivated: boolean;
			owned_repository_count: number;
			repository_membership_count: number;
			recording_session_count: number;
		};
	}>(`/admin/users/${encodeURIComponent(userId)}/delete-readiness`);

	return {
		userId: response.data.user_id,
		canDelete: response.data.can_delete,
		checks: {
			isDeactivated: response.data.checks.is_deactivated,
			ownedRepositoryCount: response.data.checks.owned_repository_count,
			repositoryMembershipCount:
				response.data.checks.repository_membership_count,
			recordingSessionCount: response.data.checks.recording_session_count,
		},
	} satisfies AdminUserDeleteReadiness;
}

export async function requestPermanentDeleteUser(userId: string) {
	const response = await apiClient.delete(
		`/admin/users/${encodeURIComponent(userId)}/permanent`,
	);
	return response.data;
}

export async function requestAdminSettings() {
	const response = await apiClient.get<{
		settings: {
			target_directory: string | null;
		};
	}>("/admin/settings");

	return {
		targetDirectory: response.data.settings.target_directory,
	} satisfies AdminSettings;
}
