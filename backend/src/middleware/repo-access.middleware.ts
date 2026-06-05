import type { NextFunction, Request, Response } from "express";

import { BadRequest, Unauthorized } from "../lib/errors";
import { repositoryAccessService } from "../services/repository-access.service";
import type { AppRepoRole } from "../types/repository";

interface RepoAccessOptions {
  minRole: AppRepoRole;
}

export const repoAccess =
  ({ minRole }: RepoAccessOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Unauthorized());
    }

    const rawRepoId = req.params.repoId;
    if (typeof rawRepoId !== "string" || !rawRepoId.trim()) {
      return next(BadRequest("Repository id is required."));
    }

    try {
      req.repositoryAccess = await repositoryAccessService.assertAccess(
        req.user.userId,
        req.user.role,
        rawRepoId,
        minRole,
      );
      return next();
    } catch (error) {
      return next(error);
    }
  };
