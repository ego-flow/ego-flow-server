import { UserRole } from "@prisma/client";

import { prisma } from "../lib/infra/prisma";
import { toAuthenticatedUser } from "../mappers/user.mapper";
import type { AppUserRole, AuthenticatedUser } from "../types/auth";

export interface UserPasswordCredential {
  id: string;
  role: AppUserRole;
  displayName: string;
  passwordHash: string;
}

export interface UserSummaryRecord {
  id: string;
  displayName: string;
  deactivated: boolean;
}

const adminUserSelect = {
  id: true,
  role: true,
  displayName: true,
  createdAt: true,
  deactivated: true,
} as const;

export type AdminUserRecord = {
  id: string;
  role: UserRole;
  displayName: string;
  createdAt: Date;
  deactivated: boolean;
};

export type UserDeletionStateRecord = {
  id: string;
  role: UserRole;
  deactivated: boolean;
};

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

  async findSummaries(userIds: string[]): Promise<UserSummaryRecord[]> {
    if (userIds.length === 0) {
      return [];
    }

    return prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
        displayName: true,
        deactivated: true,
      },
    });
  }

  async findActiveState(userId: string): Promise<{ id: string; deactivated: boolean } | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        deactivated: true,
      },
    });
  }

  async findUserId(userId: string): Promise<{ id: string } | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
  }

  async findDeletionState(userId: string): Promise<UserDeletionStateRecord | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivated: true,
      },
    });
  }

  async createAdminManagedUser(input: {
    id: string;
    passwordHash: string;
    displayName: string;
  }): Promise<AdminUserRecord> {
    return prisma.user.create({
      data: {
        id: input.id,
        passwordHash: input.passwordHash,
        role: UserRole.user,
        deactivated: false,
        displayName: input.displayName,
      },
      select: adminUserSelect,
    });
  }

  async findAllForAdmin(): Promise<AdminUserRecord[]> {
    return prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: adminUserSelect,
    });
  }

  async markDeactivated(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        deactivated: true,
      },
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await prisma.user.delete({
      where: { id: userId },
    });
  }
}

export const userRepository = new UserRepository();
