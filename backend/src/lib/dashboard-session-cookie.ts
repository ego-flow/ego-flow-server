import type { CookieOptions, Request, Response } from "express";

import { DASHBOARD_SESSION_COOKIE_NAME } from "../services/dashboard-session.service";

const isSecureRequest = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https";

const baseCookieOptions = (req: Request) =>
  ({
    httpOnly: true,
    // Browsers ignore Secure cookies on plain HTTP origins, so only enable it when
    // the public request actually arrived over HTTPS (directly or via trusted proxy).
    secure: isSecureRequest(req),
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
