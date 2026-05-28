import type { NextFunction, Request, Response } from "express";

import { BadRequest, Unauthorized } from "../lib/errors";
import { repositoryService } from "../services/repository.service";
import type { AppRepoRole } from "../types/repository";

const getValueAtPath = (source: unknown, pathExpression: string): unknown => {
  return pathExpression.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return Reflect.get(current, segment);
  }, source);
};

interface RepoAccessOptions {
  minRole: AppRepoRole;
  repoIdFrom?: string;
}

export const repoAccess =
  ({ minRole, repoIdFrom = "params.repoId" }: RepoAccessOptions) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Unauthorized());
    }

    const rawRepoId = getValueAtPath(req, repoIdFrom);
    if (typeof rawRepoId !== "string" || !rawRepoId.trim()) {
      return next(BadRequest("Repository id is required."));
    }

    try {
      req.repositoryAccess = await repositoryService.assertRepositoryAccess(
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
