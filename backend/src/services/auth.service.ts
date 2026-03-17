import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { signAccessToken, verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { LoginInput, RtmpAuthInput } from "../schemas/auth.schema";
import type { ChangeMyPasswordInput } from "../schemas/user.schema";

export class AuthService {
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { id: input.id },
    });

    if (!user) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid id or password.");
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid id or password.");
    }

    const role = user.role === UserRole.admin ? "admin" : "user";
    const token = signAccessToken({
      userId: user.id,
      role,
    });

    return {
      token,
      user: {
        id: user.id,
        role,
        displayName: user.displayName,
      },
    };
  }

  verifyRtmpAuthorization(input: RtmpAuthInput): boolean {
    try {
      const payload = verifyAccessToken(input.password);
      if (payload.userId !== input.user) {
        return false;
      }

      const allowedActions = new Set(["publish", "read", "playback"]);
      return allowedActions.has(input.action);
    } catch (_error) {
      return false;
    }
  }

  async changeMyPassword(userId: string, input: ChangeMyPasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    const isPasswordValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    const nextPasswordHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: nextPasswordHash,
      },
    });

    return {
      message: "Password changed successfully",
    };
  }
}

export const authService = new AuthService();
