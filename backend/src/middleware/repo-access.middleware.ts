import type { NextFunction, Request, Response } from "express";

import { BadRequest, Unauthorized } from "../lib/errors";
import type { RepositoryAccessAction } from "../lib/repository-access-policy";
import { repositoryAccessService } from "../services/repository-access.service";

interface RepoAccessOptions {
  action: RepositoryAccessAction;
  repositoryId?: (req: Request) => unknown;
}

export const repoAccess =
  ({ action, repositoryId }: RepoAccessOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Unauthorized());
    }

    const rawRepoId = repositoryId ? repositoryId(req) : req.params.repoId;
    if (typeof rawRepoId !== "string" || !rawRepoId.trim()) {
      return next(BadRequest("Repository id is required."));
    }

    try {
      req.repositoryAccess = await repositoryAccessService.assertAction(
        req.user.userId,
        req.user.role,
        rawRepoId.trim(),
        action,
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };
