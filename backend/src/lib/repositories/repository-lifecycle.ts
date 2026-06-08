import { RepoVisibility } from "@prisma/client";

import {
  normalizeRepositoryTags,
  toRepositoryRecord,
  toRepositoryResponse,
} from "../../mappers/repository.mapper";
import {
  isUniqueConstraintError,
  repositoriesRepository,
} from "../../repositories/repositories.repository";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import type { RepositoryAccessContext } from "../../types/repository";
import type {
  CreateRepositoryInput,
  UpdateRepositoryInput,
} from "../../types/repository/request";
import { Conflict } from "../core/errors";
import { permanentlyDeleteRepositoryData } from "./repository-delete";
import { renameRepositoryDirectory } from "./repository-directory";
import { normalizeRepositoryDescription } from "./repository-input";
import {
  assertRepositoryIsIdle,
  assertRepositoryPermanentlyDeletable,
  getRepositoryPermanentDeleteState,
} from "./repository-work-state";

export const createRepository = async (userId: string, input: CreateRepositoryInput) => {
  try {
    const repository = await repositoriesRepository.createRepository({
      name: input.name,
      ownerId: userId,
      visibility: input.visibility,
      description: normalizeRepositoryDescription(input.description),
      tags: normalizeRepositoryTags(input.tags),
      contributors: [userId],
    });

    await repoMemberRepository.createAdminMember(repository.id, userId);

    return {
      repository: toRepositoryResponse(toRepositoryRecord(repository), "admin"),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw Conflict("Repository name already exists for this owner.");
    }

    throw error;
  }
};

export const updateRepository = async (
  access: RepositoryAccessContext,
  input: UpdateRepositoryInput,
) => {
  const previousRepository = access.repository;
  const repositoryId = previousRepository.id;
  const nextName = input.name ?? previousRepository.name;
  const nextVisibility = input.visibility ?? previousRepository.visibility;
  const nextDescription =
    input.description === undefined
      ? previousRepository.description
      : normalizeRepositoryDescription(input.description);
  const nextTags = input.tags === undefined ? previousRepository.tags : normalizeRepositoryTags(input.tags);

  if (
    nextName === previousRepository.name &&
    nextVisibility === previousRepository.visibility &&
    nextDescription === previousRepository.description &&
    JSON.stringify(nextTags) === JSON.stringify(previousRepository.tags)
  ) {
    return {
      repository: toRepositoryResponse(previousRepository, access.effectiveRole),
    };
  }

  if (nextName !== previousRepository.name) {
    await assertRepositoryIsIdle(previousRepository.id);
    await renameRepositoryDirectory({
      ownerId: previousRepository.ownerId,
      previousName: previousRepository.name,
      nextName,
      repositoryId,
    });
  }

  try {
    const repository = await repositoriesRepository.updateRepository({
      repositoryId,
      name: nextName,
      visibility: nextVisibility === "public" ? RepoVisibility.public : RepoVisibility.private,
      description: nextDescription,
      tags: nextTags,
    });

    return {
      repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw Conflict("Repository name already exists for this owner.");
    }

    throw error;
  }
};

export const deactivateRepository = async (access: RepositoryAccessContext) => {
  const repositoryId = access.repository.id;

  await repositoriesRepository.markRepositoryDeactivated(repositoryId);

  return {
    id: repositoryId,
    deactivated: true,
  };
};

export const getRepositoryDeleteReadiness = async (access: RepositoryAccessContext) => {
  const state = await getRepositoryPermanentDeleteState(access.repository.id);

  return {
    repository_id: access.repository.id,
    can_delete: state.canDelete,
    checks: {
      is_deactivated: true,
      active_streaming_session_count: state.activeStreamingSessionCount,
      finalizing_segment_count: state.finalizingSegmentCount,
    },
  };
};

export const permanentlyDeleteRepository = async (access: RepositoryAccessContext) => {
  const state = await getRepositoryPermanentDeleteState(access.repository.id);
  const repositoryId = access.repository.id;

  assertRepositoryPermanentlyDeletable(state);
  await permanentlyDeleteRepositoryData(access.repository);

  return {
    id: repositoryId,
    deleted: true,
  };
};
