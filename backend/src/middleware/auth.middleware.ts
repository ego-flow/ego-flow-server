import type { NextFunction, Request, Response } from "express";

import { DASHBOARD_SESSION_COOKIE_NAME, PYTHON_TOKEN_PREFIX } from "../constants/auth/auth-constants";
import {
  isAccessTokenVerificationError,
  resolveRefreshedAccessToken,
  verifyAccessToken,
} from "../lib/auth/access-token";
import { verifyDashboardSession } from "../lib/auth/dashboard-session";
import { extractBearerToken, extractCookie } from "../lib/auth/http-credentials";
import { verifyPythonToken } from "../lib/auth/python-token";
import { Unauthorized } from "../lib/core/errors";
import { userRepository } from "../repositories/user.repository";
import { AuthCredentialKind, type AuthContext, type AuthenticatedUser } from "../types/auth";

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

  const session = await verifyDashboardSession(sessionToken);
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

  const payload = await verifyPythonToken(token);
  if (!payload) {
    throw Unauthorized("Invalid token.");
  }

  const authenticatedUser = await userRepository.findActiveAuthenticatedUser(payload.userId);
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
    const authenticatedUser = await userRepository.findActiveAuthenticatedUser(payload.userId);
    if (!authenticatedUser) {
      throw Unauthorized("App access token is invalid or expired.");
    }

    const refreshedToken = resolveRefreshedAccessToken(payload, authenticatedUser);
    if (refreshedToken) {
      res.setHeader("X-Refreshed-Token", refreshedToken);
    }

    return {
      kind: AuthCredentialKind.App,
      rawCredential: token,
      ...authenticatedUser,
    };
  } catch (error) {
    if (isAccessTokenVerificationError(error)) {
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
export const requirePythonToken = requireCredential(AuthCredentialKind.Python);
export const requireDashboardOrApp = requireCredential(AuthCredentialKind.Dashboard, AuthCredentialKind.App);
export const requireDashboardOrPython = requireCredential(AuthCredentialKind.Dashboard, AuthCredentialKind.Python);
export const requireDashboardOrAppOrPython = requireCredential(
  AuthCredentialKind.Dashboard,
  AuthCredentialKind.App,
  AuthCredentialKind.Python,
);
