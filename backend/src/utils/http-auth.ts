import { HttpAuthScheme } from "../constants/auth/auth-constants";

export const extractBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== HttpAuthScheme.Bearer || !token) {
    return null;
  }

  return token;
};
