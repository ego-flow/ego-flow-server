import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import { runtimeConfig as env } from "../../config/runtime";
import type { AuthenticatedUser, AuthTokenPayload } from "../../types/auth";

export const signAccessToken = (payload: Pick<AuthTokenPayload, "userId" | "role">): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    // jsonwebtoken typings narrow expiresIn to a non-undefined union.
    expiresIn: env.JWT_EXPIRES_IN as NonNullable<SignOptions["expiresIn"]>,
  });

export const verifyAccessToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
  }) as AuthTokenPayload;

export const shouldRefreshAccessToken = (payload: AuthTokenPayload): boolean => {
  if (!payload.exp) {
    return false;
  }

  const remainingSec = payload.exp - Math.floor(Date.now() / 1000);
  return remainingSec > 0 && remainingSec < env.JWT_REFRESH_THRESHOLD_SECONDS;
};

export const resolveRefreshedAccessToken = (
  payload: AuthTokenPayload,
  authenticatedUser: AuthenticatedUser,
): string | null => {
  if (!shouldRefreshAccessToken(payload) && authenticatedUser.role === payload.role) {
    return null;
  }

  return signAccessToken(authenticatedUser);
};

export const isAccessTokenVerificationError = (error: unknown): error is jwt.JsonWebTokenError =>
  error instanceof jwt.JsonWebTokenError;
