import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";
import type {
	RepositoryRole,
	RepositoryVisibility,
} from "#/constants/repository/repository-constants";
import {
	repositoryDeactivatePath,
	repositoryDeleteReadinessPath,
	repositoryMemberPath,
	repositoryMembersPath,
	repositoryPermanentDeletePath,
	repositoryPath,
} from "#/utils/api-paths";

export {
	RepositoryRole,
	RepositoryVisibility,
} from "#/constants/repository/repository-constants";

export interface RepositoryRecord {
	id: string;
	name: string;
	ownerId: string;
	visibility: RepositoryVisibility;
	description: string | null;
	myRole: RepositoryRole;
	createdAt: string;
	updatedAt: string;
	videoCount: number | null;
}

export interface RepositoryMember {
	userId: string;
	displayName: string;
	isActive: boolean;
	role: RepositoryRole;
	isOwner: boolean;
	createdAt: string;
}

export interface RepositoryDeleteReadiness {
	repositoryId: string;
	canDelete: boolean;
	checks: {
		isDeactivated: boolean;
		activeStreamingSessionCount: number;
		finalizingSegmentCount: number;
	};
}

interface RepositoryApiRecord {
	id: string;
	name: string;
	owner_id: string;
	visibility: RepositoryVisibility;
	description: string | null;
	my_role: RepositoryRole;
	created_at: string;
	updated_at: string;
	video_count?: number;
}

function normalizeRepository(
	repository: RepositoryApiRecord,
): RepositoryRecord {
	return {
		id: repository.id,
		name: repository.name,
		ownerId: repository.owner_id,
		visibility: repository.visibility,
		description: repository.description,
		myRole: repository.my_role,
		createdAt: repository.created_at,
		updatedAt: repository.updated_at,
		videoCount:
			typeof repository.video_count === "number"
				? repository.video_count
				: null,
	};
}

export async function requestRepositories() {
	const response = await apiClient.get<{
		repositories: RepositoryApiRecord[];
	}>(ApiEndpoint.Repositories);

	return response.data.repositories.map(
		normalizeRepository,
	) satisfies RepositoryRecord[];
}

export async function requestMaintainRepositories() {
	const response = await apiClient.get<{
		repositories: RepositoryApiRecord[];
	}>(ApiEndpoint.RepositoriesMaintain);

	return response.data.repositories.map(
		normalizeRepository,
	) satisfies RepositoryRecord[];
}

export async function requestRepositoryDetail(repoId: string) {
	const response = await apiClient.get<{
		repository: RepositoryApiRecord;
	}>(repositoryPath(repoId));

	return normalizeRepository(response.data.repository);
}

export async function requestCreateRepository(input: {
	name: string;
	visibility: RepositoryVisibility;
	description: string;
}) {
	const response = await apiClient.post<{
		repository: RepositoryApiRecord;
	}>(ApiEndpoint.Repositories, {
		name: input.name.trim(),
		visibility: input.visibility,
		description: input.description.trim() || undefined,
	});

	return normalizeRepository(response.data.repository);
}

export async function requestUpdateRepository(
	repoId: string,
	input: {
		name: string;
		visibility: RepositoryVisibility;
		description: string;
	},
) {
	const response = await apiClient.patch<{
		repository: RepositoryApiRecord;
	}>(repositoryPath(repoId), {
		name: input.name.trim(),
		visibility: input.visibility,
		description: input.description.trim() || null,
	});

	return normalizeRepository(response.data.repository);
}

export async function requestDeactivateRepository(repoId: string) {
	const response = await apiClient.delete<{
		id: string;
		deactivated: boolean;
	}>(repositoryDeactivatePath(repoId));

	return response.data;
}

export async function requestRepositoryDeleteReadiness(repoId: string) {
	const response = await apiClient.get<{
		repository_id: string;
		can_delete: boolean;
		checks: {
			is_deactivated: boolean;
			active_streaming_session_count: number;
			finalizing_segment_count: number;
		};
	}>(repositoryDeleteReadinessPath(repoId));

	return {
		repositoryId: response.data.repository_id,
		canDelete: response.data.can_delete,
		checks: {
			isDeactivated: response.data.checks.is_deactivated,
			activeStreamingSessionCount:
				response.data.checks.active_streaming_session_count,
			finalizingSegmentCount: response.data.checks.finalizing_segment_count,
		},
	} satisfies RepositoryDeleteReadiness;
}

export async function requestPermanentDeleteRepository(repoId: string) {
	const response = await apiClient.delete<{
		id: string;
		deleted: boolean;
	}>(repositoryPermanentDeletePath(repoId));

	return response.data;
}

export async function requestDeleteRepository(repoId: string) {
	await requestDeactivateRepository(repoId);
	const readiness = await requestRepositoryDeleteReadiness(repoId);
	if (!readiness.canDelete) {
		throw new Error("Repository is not ready for permanent deletion.");
	}

	return requestPermanentDeleteRepository(repoId);
}

export async function requestRepositoryMembers(repoId: string) {
	const response = await apiClient.get<{
		members: Array<{
			user_id: string;
			display_name: string;
			is_active: boolean;
			role: RepositoryRole;
			is_owner: boolean;
			created_at: string;
		}>;
	}>(repositoryMembersPath(repoId));

	return response.data.members.map((member) => ({
		userId: member.user_id,
		displayName: member.display_name,
		isActive: member.is_active,
		role: member.role,
		isOwner: member.is_owner,
		createdAt: member.created_at,
	})) satisfies RepositoryMember[];
}

export async function requestAddRepositoryMember(
	repoId: string,
	input: { userId: string; role: RepositoryRole },
) {
	await apiClient.post(repositoryMembersPath(repoId), {
		user_id: input.userId.trim(),
		role: input.role,
	});
}

export async function requestUpdateRepositoryMember(
	repoId: string,
	userId: string,
	role: RepositoryRole,
) {
	await apiClient.patch(repositoryMemberPath(repoId, userId), {
		role,
	});
}

export async function requestDeleteRepositoryMember(
	repoId: string,
	userId: string,
) {
	await apiClient.delete(repositoryMemberPath(repoId, userId));
}
