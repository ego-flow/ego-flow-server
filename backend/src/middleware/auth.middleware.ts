import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { AppError } from "../lib/errors";
import { shouldRefreshToken, signAccessToken, verifyAccessToken } from "../lib/jwt";

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

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return next(new AppError(401, "UNAUTHORIZED", "Authorization header is missing or invalid."));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.userId,
      role: payload.role,
    };

    if (shouldRefreshToken(token)) {
      const refreshed = signAccessToken({
        userId: payload.userId,
        role: payload.role,
      });
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
