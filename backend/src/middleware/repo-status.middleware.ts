import type { NextFunction, Request, Response } from "express";

import { BadRequest } from "../lib/errors";
import { repositoryAccessService, type RepositoryStatusRequirement } from "../services/repository-access.service";

interface RepoStatusOptions {
  required: RepositoryStatusRequirement;
  repositoryId?: (req: Request) => unknown;
}

export const repoStatus =
  ({ required, repositoryId }: RepoStatusOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const rawRepoId = repositoryId ? repositoryId(req) : req.params.repoId;
    if (typeof rawRepoId !== "string" || !rawRepoId.trim()) {
      return next(BadRequest("Repository id is required."));
    }

    try {
      await repositoryAccessService.assertRepositoryStatus(rawRepoId.trim(), required);
      return next();
    } catch (error) {
      return next(error);
    }
  };
