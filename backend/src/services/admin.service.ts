import bcrypt from "bcryptjs";
import { Prisma, UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getTargetDirectory } from "../lib/storage";
import type { CreateAdminUserInput, ResetUserPasswordInput } from "../schemas/admin.schema";
import type { AuthenticatedUser } from "../types/auth";

const toUserRole = (role: UserRole): "admin" | "user" => (role === UserRole.admin ? "admin" : "user");

const toUserResponse = (user: {
  id: string;
  role: UserRole;
  displayName: string | null;
  createdAt: Date;
  isActive: boolean;
}) => ({
  id: user.id,
  role: toUserRole(user.role),
  displayName: user.displayName,
  createdAt: user.createdAt.toISOString(),
  is_active: user.isActive,
});

export class AdminService {
  private async getPermanentDeleteState(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found.");
    }

    if (user.role === UserRole.admin) {
      throw new AppError(400, "VALIDATION_ERROR", "Admin account cannot be permanently deleted.");
    }

    const [ownedRepositories, memberships, recordingSessionCount] = await Promise.all([
      prisma.repository.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      }),
      prisma.repoMember.findMany({
        where: { userId: user.id },
        select: { repositoryId: true },
      }),
      prisma.recordingSession.count({
        where: {
          OR: [{ userId: user.id }, { ownerId: user.id }],
        },
      }),
    ]);

    const ownedRepositoryIds = new Set(ownedRepositories.map((repository) => repository.id));
    const repositoryMembershipCount = memberships.filter(
      (membership) => !ownedRepositoryIds.has(membership.repositoryId),
    ).length;
    const checks = {
      isDeactivated: !user.isActive,
      ownedRepositoryCount: ownedRepositories.length,
      repositoryMembershipCount,
      recordingSessionCount,
    };

    return {
      user,
      checks,
      canDelete:
        checks.isDeactivated &&
        checks.ownedRepositoryCount === 0 &&
        checks.repositoryMembershipCount === 0 &&
        checks.recordingSessionCount === 0,
    };
  }

  async getSettings() {
    return {
      settings: {
        target_directory: getTargetDirectory(),
      },
    };
  }

  async createUser(input: CreateAdminUserInput) {
    const existingUser = await prisma.user.findUnique({
      where: { id: input.id },
      select: { id: true },
    });

    if (existingUser) {
      throw new AppError(409, "CONFLICT", "User id already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    let user;

    try {
      user = await prisma.user.create({
        data: {
          id: input.id,
          passwordHash,
          role: UserRole.user,
          isActive: true,
          displayName: input.displayName ?? null,
        },
        select: {
          id: true,
          role: true,
          displayName: true,
          createdAt: true,
          isActive: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(409, "CONFLICT", "User id already exists.");
      }

      throw error;
    }

    return {
      user: toUserResponse(user),
    };
  }

  async listUsers() {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        displayName: true,
        createdAt: true,
        isActive: true,
      },
    });

    return {
      users: users.map(toUserResponse),
    };
  }

  async deactivateUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found.");
    }

    if (user.role === UserRole.admin) {
      throw new AppError(400, "VALIDATION_ERROR", "Admin account cannot be deactivated.");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: false,
      },
    });

    return {
      id: user.id,
      deleted: true,
    };
  }

  async getUserDeleteReadiness(userId: string) {
    const state = await this.getPermanentDeleteState(userId);

    return {
      user_id: state.user.id,
      can_delete: state.canDelete,
      checks: {
        is_deactivated: state.checks.isDeactivated,
        owned_repository_count: state.checks.ownedRepositoryCount,
        repository_membership_count: state.checks.repositoryMembershipCount,
        recording_session_count: state.checks.recordingSessionCount,
      },
    };
  }

  async permanentlyDeleteUser(userId: string) {
    const state = await this.getPermanentDeleteState(userId);

    if (!state.checks.isDeactivated) {
      throw new AppError(400, "VALIDATION_ERROR", "Deactivate the user before permanent deletion.");
    }

    if (
      state.checks.ownedRepositoryCount > 0 ||
      state.checks.repositoryMembershipCount > 0 ||
      state.checks.recordingSessionCount > 0
    ) {
      throw new AppError(
        409,
        "CONFLICT",
        "User cannot be permanently deleted while repositories, memberships, or recording history remain.",
      );
    }

    await prisma.user.delete({
      where: { id: state.user.id },
    });

    return {
      id: state.user.id,
      deleted: true,
    };
  }

  async resetUserPassword(userId: string, input: ResetUserPasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found.");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
      },
    });

    return {
      id: user.id,
      passwordReset: true,
    };
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        displayName: true,
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      userId: user.id,
      role: toUserRole(user.role),
      displayName: user.displayName,
    };
  }
}

export const adminService = new AdminService();
