import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";
import type { UserRole } from "#/lib/auth-session";
import {
	adminUserDeactivatePath,
	adminUserDeleteReadinessPath,
	adminUserPermanentDeletePath,
	adminUserResetPasswordPath,
} from "#/utils/api-paths";

export interface AdminUser {
	id: string;
	role: UserRole;
	displayName: string;
	createdAt: string;
	isActive: boolean;
}

export type AdminSettingValue = string | number | boolean | null;

export interface AdminSettingEntry {
	key: string;
	value: AdminSettingValue;
	sensitive: boolean;
	sourcePath: string | null;
	children: AdminSettingEntry[];
}

export interface AdminSettingSection {
	title: string;
	description: string | null;
	entries: AdminSettingEntry[];
}

export interface AdminSettings {
	targetDirectory: string | null;
	configPath: string | null;
	dotenvPath: string | null;
	sections: AdminSettingSection[];
}

interface AdminSettingEntryResponse {
	key: string;
	value: AdminSettingValue;
	sensitive: boolean;
	source_path: string | null;
	children: AdminSettingEntryResponse[];
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
			displayName: string;
			createdAt: string;
			deactivated: boolean;
		}>;
	}>(ApiEndpoint.AdminUsers);

	return response.data.users.map((user) => ({
		id: user.id,
		role: user.role,
		displayName: user.displayName,
		createdAt: user.createdAt,
		isActive: !user.deactivated,
	})) satisfies AdminUser[];
}

export async function requestCreateUser(input: {
	id: string;
	password: string;
	displayName: string;
}) {
	const response = await apiClient.post(ApiEndpoint.AdminUsers, {
		id: input.id,
		password: input.password,
		displayName: input.displayName.trim() || undefined,
	});

	return response.data;
}

export async function requestResetUserPassword(
	userId: string,
	newPassword: string,
) {
	const response = await apiClient.put(adminUserResetPasswordPath(userId), {
		newPassword,
	});

	return response.data;
}

export async function requestDeactivateUser(userId: string) {
	const response = await apiClient.delete(adminUserDeactivatePath(userId));
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
	}>(adminUserDeleteReadinessPath(userId));

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
	const response = await apiClient.delete(adminUserPermanentDeletePath(userId));
	return response.data;
}

export async function requestAdminSettings() {
	const response = await apiClient.get<{
		settings: {
			target_directory: string | null;
			config_path: string | null;
			dotenv_path: string | null;
			sections: Array<{
				title: string;
				description: string | null;
				entries: AdminSettingEntryResponse[];
			}>;
		};
	}>(ApiEndpoint.AdminSettings);

	const toAdminSettingEntry = (
		entry: AdminSettingEntryResponse,
	): AdminSettingEntry => ({
		key: entry.key,
		value: entry.value,
		sensitive: entry.sensitive,
		sourcePath: entry.source_path,
		children: entry.children.map(toAdminSettingEntry),
	});

	return {
		targetDirectory: response.data.settings.target_directory,
		configPath: response.data.settings.config_path,
		dotenvPath: response.data.settings.dotenv_path,
		sections: response.data.settings.sections.map((section) => ({
			title: section.title,
			description: section.description,
			entries: section.entries.map(toAdminSettingEntry),
		})),
	} satisfies AdminSettings;
}
