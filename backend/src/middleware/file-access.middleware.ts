import type { NextFunction, Request, Response } from "express";

import { AppError } from "../lib/errors";

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

export const requireFileAccess = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError(401, "UNAUTHORIZED", "Authentication is required."));
  }

  const segments = req.path
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeSegment(segment));

  if (segments.length !== 3 || !segments.every(isSafePathSegment)) {
    return next(new AppError(400, "INVALID_FILE_PATH", "File path is invalid."));
  }

  const userId = segments[0];
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    return next(new AppError(400, "INVALID_FILE_PATH", "File path is invalid."));
  }

  if (req.user.role !== "admin" && req.user.userId !== userId) {
    return next(new AppError(403, "FORBIDDEN", "You do not have access to this file."));
  }

  return next();
};
