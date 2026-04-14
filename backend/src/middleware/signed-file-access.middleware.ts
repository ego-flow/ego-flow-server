import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

import { AppError } from "../lib/errors";
import { verifySignedFileUrlToken } from "../lib/signed-file-url";

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

const getRequestedRelativePath = (requestPath: string): string => {
  const segments = requestPath
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeSegment(segment));

  if (segments.length < 3 || segments.length > 4 || !segments.every(isSafePathSegment)) {
    throw new AppError(400, "INVALID_FILE_PATH", "File path is invalid.");
  }

  return segments.join("/");
};

const getSignature = (req: Request): string | null => {
  const value = req.query.signature;
  return typeof value === "string" && value.trim() ? value : null;
};

export const requireSignedFileAccess = (req: Request, _res: Response, next: NextFunction) => {
  const signature = getSignature(req);
  if (!signature) {
    return next(new AppError(401, "UNAUTHORIZED", "Signed file URL is missing or invalid."));
  }

  try {
    const payload = verifySignedFileUrlToken(signature);
    const requestedPath = getRequestedRelativePath(req.path);
    if (payload.path !== requestedPath) {
      return next(new AppError(401, "UNAUTHORIZED", "Signed file URL is invalid."));
    }

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, "UNAUTHORIZED", "Signed file URL is invalid or expired."));
    }

    return next(error);
  }
};
