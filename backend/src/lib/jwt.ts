import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import { env } from "../config/env";
import type { AuthTokenPayload } from "../types/auth";

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

export const shouldRefreshToken = (token: string): boolean => {
  const decoded = jwt.decode(token) as AuthTokenPayload | null;
  if (!decoded?.exp) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const remainingSec = decoded.exp - now;
  return remainingSec > 0 && remainingSec < env.JWT_REFRESH_THRESHOLD_SECONDS;
};
