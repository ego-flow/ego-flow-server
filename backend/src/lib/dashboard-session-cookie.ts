import type { CookieOptions, Request, Response } from "express";

import { runtimeConfig as env } from "../config/runtime";
import { DASHBOARD_SESSION_COOKIE_NAME } from "../services/dashboard-session.service";

const isSecureRequest = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https";

const baseCookieOptions = (req: Request) =>
  ({
    httpOnly: true,
    secure: env.NODE_ENV === "production" || isSecureRequest(req),
    sameSite: "lax" as const,
    path: "/",
  }) satisfies CookieOptions;

export const setDashboardSessionCookie = (
  req: Request,
  res: Response,
  token: string,
  options: {
    persistent: boolean;
    expiresAt: Date;
  },
) => {
  res.cookie(DASHBOARD_SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions(req),
    ...(options.persistent ? { expires: options.expiresAt } : {}),
  });
};

export const clearDashboardSessionCookie = (req: Request, res: Response) => {
  res.clearCookie(DASHBOARD_SESSION_COOKIE_NAME, baseCookieOptions(req));
};
