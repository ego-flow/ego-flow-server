import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { signAccessToken, verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { LoginInput, RtmpAuthInput } from "../schemas/auth.schema";
import type { ChangeMyPasswordInput } from "../schemas/user.schema";
import { adminService } from "./admin.service";
import { repositoryService } from "./repository.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamService } from "./stream.service";

export class AuthService {
  private logRtmpAuthDecision(
    outcome: "allowed" | "denied",
    input: Partial<RtmpAuthInput>,
    details: Record<string, unknown> = {},
  ) {
    const path = typeof input.path === "string" ? input.path : null;
    let repositoryName: string | null = null;

    if (path) {
      try {
        repositoryName = streamService.extractRepositoryName(path);
      } catch (_error) {
        repositoryName = null;
      }
    }

    const payload = {
      action: input.action ?? null,
      path,
      repositoryName,
      protocol: input.protocol ?? null,
      requestedUser: input.user ?? null,
      streamSourceId: input.id ?? null,
      sourceIp: input.ip ?? null,
      ...details,
    };

    if (outcome === "allowed") {
      console.info("[rtmp-auth] allowed", payload);
      return;
    }

    console.warn("[rtmp-auth] denied", payload);
  }

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

  /**
   * [RTMP publish/read 인증]
   * MediaMTX가 POST /api/v1/auth/rtmp로 전달한 요청을 검증한다.
   * 1. action이 "publish"이면 publish ticket와 current owner lease만 검증한다.
   * 2. publish auth는 owner truth를 mutate하지 않고, 상태 승격은 stream-ready hook이 담당한다.
   * 3. action이 "read"/"playback"이면 기존 JWT/Bearer를 검증한다.
   * 4. playback은 활성 사용자 및 repository read 권한을 확인한다.
   */
  async verifyRtmpAuthorization(input: RtmpAuthInput): Promise<boolean> {
    try {
      const queryParams = new URLSearchParams(input.query ?? "");
      const publishTicketId = streamOwnershipService.extractTicketId(input.query);
      const credentialSource = input.password
        ? "password"
        : input.token
          ? "token"
          : publishTicketId
            ? "query.ticket"
          : queryParams.get("pass")
            ? "query.pass"
            : queryParams.get("token")
              ? "query.token"
              : null;

      if (input.action === "publish") {
        if (input.password || input.token || queryParams.get("pass") || queryParams.get("token")) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "legacy-publish-credential-not-allowed",
            credentialSource,
            ticketId: publishTicketId,
          });
          return false;
        }

        const validation = await streamOwnershipService.validatePublishTicket(input.path, input.query);
        if (!validation.ok) {
          this.logRtmpAuthDecision("denied", input, {
            reason: validation.reason,
            credentialSource,
            ticketId: validation.ticketId,
          });
          return false;
        }

        this.logRtmpAuthDecision("allowed", input, {
          authenticatedUserId: validation.ticket.userId,
          recordingSessionId: validation.ticket.recordingSessionId,
          repositoryId: validation.ticket.repositoryId,
          credentialSource,
          ticketId: validation.ticket.ticketId,
          connectionId: validation.ticket.connectionId,
          generation: validation.ticket.generation,
        });
        return true;
      }

      if (input.action === "read" || input.action === "playback") {
        if (publishTicketId) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "publish-ticket-not-allowed-for-playback",
            credentialSource,
            ticketId: publishTicketId,
          });
          return false;
        }

        const credential = input.password || input.token || queryParams.get("pass") || queryParams.get("token");
        if (!credential) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "missing-credential",
            credentialSource,
          });
          return false;
        }

        const payload = verifyAccessToken(credential);
        const requestedUser = input.user || queryParams.get("user");
        if (requestedUser && payload.userId !== requestedUser) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "requested-user-mismatch",
            authenticatedUserId: payload.userId,
            credentialSource,
          });
          return false;
        }

        const authenticatedUser = await adminService.getAuthenticatedUser(payload.userId);
        if (!authenticatedUser) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "inactive-or-missing-user",
            authenticatedUserId: payload.userId,
            credentialSource,
          });
          return false;
        }

        const activeSession = await streamService.findLiveSessionByStreamPath(input.path);
        if (!activeSession) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "no-active-session",
            authenticatedUserId: authenticatedUser.userId,
            credentialSource,
          });
          return false;
        }

        const access = await repositoryService.getRepositoryAccess(
          authenticatedUser.userId,
          authenticatedUser.role,
          activeSession.repositoryId,
        );
        if (!access) {
          this.logRtmpAuthDecision("denied", input, {
            reason: "repository-access-denied",
            authenticatedUserId: authenticatedUser.userId,
            userRole: authenticatedUser.role,
            repositoryId: activeSession.repositoryId,
            recordingSessionId: activeSession.recordingSessionId,
            credentialSource,
          });
          return false;
        }

        this.logRtmpAuthDecision("allowed", input, {
          authenticatedUserId: authenticatedUser.userId,
          userRole: authenticatedUser.role,
          repositoryId: activeSession.repositoryId,
          recordingSessionId: activeSession.recordingSessionId,
          credentialSource,
        });
        return true;
      }

      this.logRtmpAuthDecision("denied", input, {
        reason: "unsupported-action",
        credentialSource,
      });
      return false;
    } catch (_error) {
      this.logRtmpAuthDecision("denied", input, {
        reason: "exception",
      });
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
