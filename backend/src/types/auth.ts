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
