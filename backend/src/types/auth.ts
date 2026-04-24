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
  displayName: string | null;
}

export type AuthCredentialKind = "dashboard" | "app" | "python";

export interface AuthContext extends AuthenticatedUser {
  kind: AuthCredentialKind;
  credentialId?: string;
  rawCredential?: string;
}
