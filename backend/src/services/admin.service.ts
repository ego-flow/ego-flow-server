import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

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
    const user = await prisma.user.create({
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
      throw new AppError(400, "VALIDATION_ERROR", "Admin account cannot be deleted.");
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
