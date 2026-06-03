import { ApiEndpoint } from "#/constants/api/api-constants";

export const adminUserPath = (userId: string) =>
	`${ApiEndpoint.AdminUsers}/${encodeURIComponent(userId)}`;

export const adminUserDeleteReadinessPath = (userId: string) =>
	`${adminUserPath(userId)}/delete-readiness`;

export const adminUserPermanentDeletePath = (userId: string) =>
	adminUserPath(userId);

export const adminUserDeactivatePath = (userId: string) =>
	`${adminUserPath(userId)}/deactivate`;

export const adminUserResetPasswordPath = (userId: string) =>
	`${adminUserPath(userId)}/password`;

export const authTokenPath = (tokenId: string) =>
	`${ApiEndpoint.AuthPythonTokens}/${encodeURIComponent(tokenId)}`;

export const repositoryPath = (repoId: string) =>
	`${ApiEndpoint.Repositories}/${repoId}`;

export const repositoryMembersPath = (repoId: string) =>
	`${repositoryPath(repoId)}/members`;

export const repositoryMemberPath = (repoId: string, userId: string) =>
	`${repositoryMembersPath(repoId)}/${encodeURIComponent(userId)}`;

export const repositoryVideosPath = (repoId: string) =>
	`${repositoryPath(repoId)}/videos`;

export const repositoryVideoPath = (repoId: string, videoId: string) =>
	`${repositoryVideosPath(repoId)}/${videoId}`;

export const repositoryVideoStatusPath = (repoId: string, videoId: string) =>
	`${repositoryVideoPath(repoId, videoId)}/status`;

export const repositoryVideoDownloadPath = (repoId: string, videoId: string) =>
	`${repositoryVideoPath(repoId, videoId)}/download`;
