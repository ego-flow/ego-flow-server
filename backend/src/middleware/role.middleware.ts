import type { NextFunction, Request, Response } from "express";

import { AppError } from "../lib/errors";
import type { AppUserRole } from "../types/auth";

export const requireRole =
  (...roles: AppUserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication is required."));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have permission for this action."));
    }
    return next();
  };
