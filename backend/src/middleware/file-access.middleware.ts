import type { NextFunction, Request, Response } from "express";

import { AppError } from "../lib/errors";
import { repositoryService } from "../services/repository.service";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const REPOSITORY_NAME_PATTERN = /^[a-z0-9_-]{1,64}$/;

const decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new AppError(400, "INVALID_FILE_PATH", "File path is invalid.");
  }
};

const isSafePathSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !segment.includes("/") &&
  !segment.includes("\\");

export const requireFileAccess = async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError(401, "UNAUTHORIZED", "Authentication is required."));
  }

  const segments = req.path
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeSegment(segment));

  if (segments.length < 3 || segments.length > 4 || !segments.every(isSafePathSegment)) {
    return next(new AppError(400, "INVALID_FILE_PATH", "File path is invalid."));
  }

  const ownerId = segments[0];
  const repositoryName = segments[1];
  if (!ownerId || !USER_ID_PATTERN.test(ownerId) || !repositoryName || !REPOSITORY_NAME_PATTERN.test(repositoryName)) {
    return next(new AppError(400, "INVALID_FILE_PATH", "File path is invalid."));
  }

  try {
    await repositoryService.assertRepositoryAccessByOwnerAndName(
      req.user.userId,
      req.user.role,
      ownerId,
      repositoryName,
      "read",
    );
    return next();
  } catch (error) {
    return next(error);
  }
};
