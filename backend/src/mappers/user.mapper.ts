import { UserRole } from "@prisma/client";

import type {
  AppUserRole,
  AuthenticatedUser,
  AuthenticatedUserResponse,
  CredentialUserResponse,
} from "../types/auth";

export const toAppUserRole = (role: UserRole): AppUserRole => (role === UserRole.admin ? "admin" : "user");

export const toAuthenticatedUser = (user: {
  id: string;
  role: UserRole;
  displayName: string;
}): AuthenticatedUser => ({
  userId: user.id,
  role: toAppUserRole(user.role),
  displayName: user.displayName,
});

export const toCredentialUserResponse = (user: {
  id: string;
  role: AppUserRole;
  displayName: string;
}): CredentialUserResponse => ({
  id: user.id,
  role: user.role,
  displayName: user.displayName,
});

export const toAuthenticatedUserResponse = (user: AuthenticatedUser): AuthenticatedUserResponse => ({
  id: user.userId,
  role: user.role,
  display_name: user.displayName,
});
