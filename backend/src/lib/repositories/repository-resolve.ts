import { toRepositoryRecord, toRepositoryResponse } from "../../mappers/repository.mapper";
import { repositoriesRepository } from "../../repositories/repositories.repository";
import type { AppUserRole } from "../../types/auth";
import { NotFound } from "../core/errors";
import { repositoryAccessService } from "./repository-access";

export const resolveRepositoryByOwnerAndName = async (
  requestUserId: string,
  requestUserRole: AppUserRole,
  ownerId: string,
  repoName: string,
) => {
  const repository = await repositoriesRepository.findRepositoryByOwnerAndName(ownerId, repoName);

  if (!repository || repository.deactivated) {
    throw NotFound("Repository not found.");
  }

  const access = await repositoryAccessService.getAccessForAction(
    requestUserId,
    requestUserRole,
    repository.id,
    "repository.read",
  );
  if (!access) {
    throw NotFound("Repository not found.");
  }

  return {
    repository: toRepositoryResponse(toRepositoryRecord(repository), access.effectiveRole),
  };
};
