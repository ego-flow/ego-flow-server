import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { AppError } from "../lib/errors";
import { shouldRefreshToken, signAccessToken, verifyAccessToken } from "../lib/jwt";
import { apiTokenService } from "../services/api-token.service";
import { adminService } from "../services/admin.service";

const extractBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token;
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return next(new AppError(401, "UNAUTHORIZED", "Authorization header is missing or invalid."));
  }

  if (token.startsWith("ef_")) {
    try {
      const payload = await apiTokenService.verifyStaticToken(token);
      if (!payload) {
        return next(new AppError(401, "UNAUTHORIZED", "Invalid token."));
      }

      const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
      if (!authenticatedUser) {
        return next(new AppError(401, "UNAUTHORIZED", "Invalid token."));
      }

      req.user = authenticatedUser;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  try {
    const payload = verifyAccessToken(token);
    const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
    if (!authenticatedUser) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired token.");
    }

    req.user = authenticatedUser;

    if (shouldRefreshToken(token) || authenticatedUser.role !== payload.role) {
      const refreshed = signAccessToken(authenticatedUser);
      res.setHeader("X-Refreshed-Token", refreshed);
    }

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token."));
    }
    return next(error);
  }
};
