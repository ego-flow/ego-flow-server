import { prisma } from "../lib/prisma";
import { toAuthenticatedUser } from "../mappers/user.mapper";
import type { AppUserRole, AuthenticatedUser } from "../types/auth";

export interface UserPasswordCredential {
  id: string;
  role: AppUserRole;
  displayName: string;
  passwordHash: string;
}

export class UserRepository {
  async findActiveAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivated: true,
        displayName: true,
      },
    });

    if (!user || user.deactivated) {
      return null;
    }

    return toAuthenticatedUser(user);
  }

  async findActivePasswordCredential(userId: string): Promise<UserPasswordCredential | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivated: true,
        displayName: true,
        passwordHash: true,
      },
    });

    if (!user || user.deactivated) {
      return null;
    }

    const authenticatedUser = toAuthenticatedUser(user);

    return {
      id: authenticatedUser.userId,
      role: authenticatedUser.role,
      displayName: authenticatedUser.displayName,
      passwordHash: user.passwordHash,
    };
  }

  async updatePasswordHash(userId: string, passwordHash: string) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
      },
    });
  }
}

export const userRepository = new UserRepository();
