import { mkdir } from "fs/promises";
import path from "path";

import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type {
  CreateAdminUserInput,
  ResetUserPasswordInput,
  UpdateTargetDirectoryInput,
} from "../schemas/admin.schema";

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
    const setting = await prisma.setting.findUnique({
      where: { key: "target_directory" },
      select: { value: true },
    });

    return {
      settings: {
        target_directory: setting?.value ?? null,
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

  async updateTargetDirectory(input: UpdateTargetDirectoryInput) {
    const targetDirectory = path.resolve(input.target_directory);

    if (!path.isAbsolute(targetDirectory)) {
      throw new AppError(400, "VALIDATION_ERROR", "target_directory must be an absolute path.");
    }

    try {
      await mkdir(targetDirectory, { recursive: true });
    } catch (_error) {
      throw new AppError(400, "VALIDATION_ERROR", "Failed to create target directory.");
    }

    await prisma.setting.upsert({
      where: { key: "target_directory" },
      update: { value: targetDirectory },
      create: {
        key: "target_directory",
        value: targetDirectory,
      },
    });

    return {
      target_directory: targetDirectory,
    };
  }

  async getAuthenticatedUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      userId: user.id,
      role: toUserRole(user.role),
    };
  }
}

export const adminService = new AdminService();
