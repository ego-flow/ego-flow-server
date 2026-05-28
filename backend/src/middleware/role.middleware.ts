import type { NextFunction, Request, Response } from "express";

import { Forbidden, Unauthorized } from "../lib/errors";
import type { AppUserRole } from "../types/auth";

export const requireRole =
  (...roles: AppUserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(Forbidden());
    }
    return next();
  };
