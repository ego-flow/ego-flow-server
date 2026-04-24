import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { AppError } from "../lib/errors";
import { shouldRefreshToken, signAccessToken, verifyAccessToken } from "../lib/jwt";
import { apiTokenService } from "../services/api-token.service";
import { adminService } from "../services/admin.service";
import {
  DASHBOARD_SESSION_COOKIE_NAME,
  dashboardSessionService,
} from "../services/dashboard-session.service";
import type { AuthContext, AuthCredentialKind, AuthenticatedUser } from "../types/auth";

const PYTHON_TOKEN_PREFIX = "ef_";

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

const extractCookie = (cookieHeader: string | undefined, name: string): string | null => {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name && rawValue.length > 0) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
};

const setAuthContext = (req: Request, context: AuthContext) => {
  req.auth = context;
  req.user = {
    userId: context.userId,
    role: context.role,
    displayName: context.displayName,
  } satisfies AuthenticatedUser;
};

const authenticateDashboardSession = async (req: Request): Promise<AuthContext | null> => {
  const sessionToken = extractCookie(req.headers.cookie, DASHBOARD_SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return null;
  }

  const session = await dashboardSessionService.verifySession(sessionToken);
  if (!session) {
    throw new AppError(401, "UNAUTHORIZED", "Dashboard session is invalid or expired.");
  }

  return {
    kind: "dashboard",
    credentialId: session.sessionId,
    rawCredential: sessionToken,
    userId: session.userId,
    role: session.role,
    displayName: session.displayName,
  };
};

const authenticatePythonToken = async (req: Request): Promise<AuthContext | null> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token?.startsWith(PYTHON_TOKEN_PREFIX)) {
    return null;
  }

  const payload = await apiTokenService.verifyPythonToken(token);
  if (!payload) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid token.");
  }

  const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
  if (!authenticatedUser) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid token.");
  }

  return {
    kind: "python",
    rawCredential: token,
    ...authenticatedUser,
  };
};

const authenticateAppJwt = async (req: Request, res: Response): Promise<AuthContext | null> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || token.startsWith(PYTHON_TOKEN_PREFIX)) {
    return null;
  }

  try {
    const payload = verifyAccessToken(token);
    const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
    if (!authenticatedUser) {
      throw new AppError(401, "UNAUTHORIZED", "App access token is invalid or expired.");
    }

    if (shouldRefreshToken(token) || authenticatedUser.role !== payload.role) {
      const refreshed = signAccessToken(authenticatedUser);
      res.setHeader("X-Refreshed-Token", refreshed);
    }

    return {
      kind: "app",
      rawCredential: token,
      ...authenticatedUser,
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError(401, "UNAUTHORIZED", "App access token is invalid or expired.");
    }
    throw error;
  }
};

const authenticateByKind = async (
  req: Request,
  res: Response,
  kind: AuthCredentialKind,
): Promise<AuthContext | null> => {
  if (kind === "dashboard") {
    return authenticateDashboardSession(req);
  }
  if (kind === "app") {
    return authenticateAppJwt(req, res);
  }
  return authenticatePythonToken(req);
};

export const requireCredential =
  (...allowedKinds: AuthCredentialKind[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      for (const kind of allowedKinds) {
        const context = await authenticateByKind(req, res, kind);
        if (context) {
          setAuthContext(req, context);
          return next();
        }
      }

      return next(new AppError(401, "UNAUTHORIZED", "Authentication is required."));
    } catch (error) {
      return next(error);
    }
  };

export const requireDashboardSession = requireCredential("dashboard");
export const requireAppJwt = requireCredential("app");
export const requirePythonToken = requireCredential("python");
export const requireDashboardOrApp = requireCredential("dashboard", "app");
export const requireDashboardOrPython = requireCredential("dashboard", "python");
export const requireDashboardOrAppOrPython = requireCredential("dashboard", "app", "python");

// Backward-compatible guard for tests and legacy internal routes. New routes should use a specific guard.
export const requireAuth = requireCredential("dashboard", "app", "python");
