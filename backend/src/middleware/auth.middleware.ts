import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { DASHBOARD_SESSION_COOKIE_NAME, PYTHON_TOKEN_PREFIX } from "../constants/auth/auth-constants";
import { Unauthorized } from "../lib/errors";
import { shouldRefreshToken, signAccessToken, verifyAccessToken } from "../lib/jwt";
import { apiTokenService } from "../services/api-token.service";
import { adminService } from "../services/admin.service";
import { dashboardSessionService } from "../services/dashboard-session.service";
import { AuthCredentialKind, type AuthContext, type AuthenticatedUser } from "../types/auth";
import { extractBearerToken } from "../utils/http-auth";
import { extractCookie } from "../utils/http-cookie";

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
    throw Unauthorized("Dashboard session is invalid or expired.");
  }

  return {
    kind: AuthCredentialKind.Dashboard,
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
    throw Unauthorized("Invalid token.");
  }

  const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
  if (!authenticatedUser) {
    throw Unauthorized("Invalid token.");
  }

  return {
    kind: AuthCredentialKind.Python,
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
      throw Unauthorized("App access token is invalid or expired.");
    }

    if (shouldRefreshToken(token) || authenticatedUser.role !== payload.role) {
      const refreshed = signAccessToken(authenticatedUser);
      res.setHeader("X-Refreshed-Token", refreshed);
    }

    return {
      kind: AuthCredentialKind.App,
      rawCredential: token,
      ...authenticatedUser,
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw Unauthorized("App access token is invalid or expired.");
    }
    throw error;
  }
};

const authenticateByKind = async (
  req: Request,
  res: Response,
  kind: AuthCredentialKind,
): Promise<AuthContext | null> => {
  if (kind === AuthCredentialKind.Dashboard) {
    return authenticateDashboardSession(req);
  }
  if (kind === AuthCredentialKind.App) {
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

      return next(Unauthorized());
    } catch (error) {
      return next(error);
    }
  };

export const requireDashboardSession = requireCredential(AuthCredentialKind.Dashboard);
export const requireAppJwt = requireCredential(AuthCredentialKind.App);
export const requireAppJwtPayloadOnly = async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || token.startsWith(PYTHON_TOKEN_PREFIX)) {
    return next(Unauthorized());
  }

  try {
    const payload = verifyAccessToken(token);
    setAuthContext(req, {
      kind: AuthCredentialKind.App,
      rawCredential: token,
      userId: payload.userId,
      role: payload.role,
      displayName: payload.userId,
    });
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(Unauthorized("App access token is invalid or expired."));
    }
    return next(error);
  }
};
export const requirePythonToken = requireCredential(AuthCredentialKind.Python);
export const requireDashboardOrApp = requireCredential(AuthCredentialKind.Dashboard, AuthCredentialKind.App);
export const requireDashboardOrPython = requireCredential(AuthCredentialKind.Dashboard, AuthCredentialKind.Python);
export const requireDashboardOrAppOrPython = requireCredential(
  AuthCredentialKind.Dashboard,
  AuthCredentialKind.App,
  AuthCredentialKind.Python,
);
