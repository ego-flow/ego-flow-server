import { AuthCredentialKind } from "../constants/auth/auth-constants";

export { AuthCredentialKind } from "../constants/auth/auth-constants";

export type AppUserRole = "admin" | "user";

export interface AuthTokenPayload {
  userId: string;
  role: AppUserRole;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  role: AppUserRole;
  displayName: string;
}

export interface AuthContext extends AuthenticatedUser {
  kind: AuthCredentialKind;
  credentialId?: string;
  rawCredential?: string;
}
