import { UserRole } from "@prisma/client";

import type { AppUserRole, AuthenticatedUser } from "../types/auth";

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
