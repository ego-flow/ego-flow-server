import { toRepositoryResponse } from "../../mappers/repository.mapper";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { userRepository } from "../../repositories/user.repository";
import type { RepositoryAccessContext } from "../../types/repository";
import type {
  CreateRepositoryMemberInput,
  UpdateRepositoryMemberInput,
} from "../../types/repository/request";
import { BadRequest, NotFound } from "../core/errors";
import { refreshRepositoryContributors } from "./repository-contributors";
import { toAppRepoRole } from "./roles";

const ensureTargetUserCanBeManaged = async (ownerId: string, targetUserId: string) => {
  if (ownerId === targetUserId) {
    throw BadRequest("Repository owner membership cannot be changed.");
  }

  const targetUser = await userRepository.findActiveState(targetUserId);

  if (!targetUser) {
    throw NotFound("User not found.");
  }

  if (targetUser.deactivated) {
    throw BadRequest("Inactive users cannot be added to a repository.");
  }
};

export const listRepositoryMembers = async (access: RepositoryAccessContext) => {
  const repositoryId = access.repository.id;

  const memberships = await repoMemberRepository.findRepositoryMembers(repositoryId);
  const users = await userRepository.findSummaries(memberships.map((membership) => membership.userId));

  const userMap = new Map(users.map((user) => [user.id, user]));

  return {
    repository: toRepositoryResponse(access.repository, access.effectiveRole),
    members: memberships.map((membership) => {
      const memberUser = userMap.get(membership.userId);
      return {
        user_id: membership.userId,
        display_name: memberUser?.displayName ?? membership.userId,
        is_active: memberUser ? !memberUser.deactivated : false,
        role: toAppRepoRole(membership.role),
        is_owner: membership.userId === access.repository.ownerId,
        created_at: membership.createdAt.toISOString(),
      };
    }),
  };
};

export const addRepositoryMember = async (
  access: RepositoryAccessContext,
  input: CreateRepositoryMemberInput,
) => {
  const repositoryId = access.repository.id;
  await ensureTargetUserCanBeManaged(access.repository.ownerId, input.user_id);

  await repoMemberRepository.upsertRepositoryMember({
    repositoryId,
    userId: input.user_id,
    role: input.role,
  });
  await refreshRepositoryContributors(repositoryId);

  return listRepositoryMembers(access);
};

export const updateRepositoryMember = async (
  access: RepositoryAccessContext,
  targetUserId: string,
  input: UpdateRepositoryMemberInput,
) => {
  const repositoryId = access.repository.id;
  await ensureTargetUserCanBeManaged(access.repository.ownerId, targetUserId);

  const membership = await repoMemberRepository.findRepositoryMembership(repositoryId, targetUserId);

  if (!membership) {
    throw NotFound("Repository member not found.");
  }

  await repoMemberRepository.updateRepositoryMemberRole({
    repositoryId,
    userId: targetUserId,
    role: input.role,
  });
  await refreshRepositoryContributors(repositoryId);

  return listRepositoryMembers(access);
};

export const deleteRepositoryMember = async (
  access: RepositoryAccessContext,
  targetUserId: string,
) => {
  const repositoryId = access.repository.id;
  await ensureTargetUserCanBeManaged(access.repository.ownerId, targetUserId);

  const membership = await repoMemberRepository.findRepositoryMembership(repositoryId, targetUserId);

  if (!membership) {
    throw NotFound("Repository member not found.");
  }

  await repoMemberRepository.deleteRepositoryMember(repositoryId, targetUserId);
  await refreshRepositoryContributors(repositoryId);

  return {
    repository_id: repositoryId,
    user_id: targetUserId,
    deleted: true,
  };
};
