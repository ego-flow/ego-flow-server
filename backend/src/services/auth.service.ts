import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { signAccessToken, verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { LoginInput, RtmpAuthInput } from "../schemas/auth.schema";
import type { ChangeMyPasswordInput } from "../schemas/user.schema";
import { adminService } from "./admin.service";
import { repositoryService } from "./repository.service";
import { streamService } from "./stream.service";

export class AuthService {
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { id: input.id },
    });

    if (!user) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid id or password.");
    }

    if (!user.isActive) {
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

  async verifyRtmpAuthorization(input: RtmpAuthInput): Promise<boolean> {
    try {
      const queryParams = new URLSearchParams(input.query ?? "");
      const credential = input.password || input.token || queryParams.get("pass") || queryParams.get("token");
      if (!credential) {
        return false;
      }

      const payload = verifyAccessToken(credential);
      const requestedUser = input.user || queryParams.get("user");
      if (requestedUser && payload.userId !== requestedUser) {
        return false;
      }

      const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
      if (!authenticatedUser) {
        return false;
      }

      const activeSession = await streamService.findLiveSessionByStreamPath(input.path);
      if (!activeSession) {
        return false;
      }

      if (input.action === "publish") {
        if (activeSession.userId !== authenticatedUser.userId) {
          return false;
        }

        const activatedSession = await streamService.activateSession(activeSession.recordingSessionId);
        return Boolean(activatedSession);
      }

      if (input.action === "read" || input.action === "playback") {
        const access = await repositoryService.getRepositoryAccess(
          authenticatedUser.userId,
          authenticatedUser.role,
          activeSession.repositoryId,
        );
        return Boolean(access);
      }

      return false;
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

    if (!user.isActive) {
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
