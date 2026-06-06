import type { NextFunction, Request, Response } from "express";

import { BadRequest, Unauthorized } from "../lib/errors";
import type { RepositoryAccessAction } from "../lib/repository-access-policy";
import { repositoryAccessService, type RepositoryStatusRequirement } from "../services/repository-access.service";

type RepositoryIdResolver = (req: Request) => unknown;

interface RepoAccessOptions {
  action: RepositoryAccessAction;
  repositoryId?: RepositoryIdResolver;
}

interface RepoStatusOptions {
  required: RepositoryStatusRequirement;
  repositoryId?: RepositoryIdResolver;
}

const resolveRepositoryId = (req: Request, repositoryId?: RepositoryIdResolver) => {
  const rawRepoId = repositoryId ? repositoryId(req) : req.params.repoId;
  if (typeof rawRepoId !== "string" || !rawRepoId.trim()) {
    throw BadRequest("Repository id is required.");
  }

  return rawRepoId.trim();
};

export const repoAccess =
  ({ action, repositoryId }: RepoAccessOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Unauthorized());
    }

    try {
      const repoId = resolveRepositoryId(req, repositoryId);
      req.repositoryAccess = await repositoryAccessService.assertAction(
        req.user.userId,
        req.user.role,
        repoId,
        action,
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };

export const repoStatus =
  ({ required, repositoryId }: RepoStatusOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const repoId = resolveRepositoryId(req, repositoryId);
      await repositoryAccessService.assertRepositoryStatus(repoId, required);
      return next();
    } catch (error) {
      return next(error);
    }
  };
