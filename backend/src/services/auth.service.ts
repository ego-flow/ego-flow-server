import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { AppError } from "../lib/errors";
import { signAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { LoginInput, RtmpAuthInput } from "../schemas/auth.schema";
import type { ChangeMyPasswordInput } from "../schemas/user.schema";
import type { AppUserRole } from "../types/auth";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamService } from "./stream.service";
import { dashboardSessionService } from "./dashboard-session.service";

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

  private async authenticatePassword(input: LoginInput) {
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

    const role: AppUserRole = user.role === UserRole.admin ? "admin" : "user";
    return {
      id: user.id,
      role,
      displayName: user.displayName,
    };
  }

  async login(input: LoginInput) {
    const user = await this.authenticatePassword(input);
    const token = signAccessToken({
      userId: user.id,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }

  async loginDashboard(input: LoginInput & { remember_me?: boolean }) {
    const user = await this.authenticatePassword(input);
    const session = await dashboardSessionService.createSession(user.id, Boolean(input.remember_me));

    return {
      session,
      user: {
        id: user.id,
        role: user.role,
        displayName: user.displayName,
      },
    };
  }

  /**
   * [RTMP publish 인증]
   * MediaMTX가 POST /api/v1/auth/rtmp로 전달한 publish 요청을 검증한다.
   * 1. publish ticket와 current owner lease만 검증한다.
   * 2. owner truth를 mutate하지 않고, 상태 승격은 stream-ready hook이 담당한다.
   * 3. read/playback action은 mediamtx.yml `authHTTPExclude`로 우회되므로 호출되지 않는다.
   *    혹시 우회 설정이 누락되어 들어오면 deny한다 (Caddy `forward_auth`가 진짜 gate).
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

      if (input.action !== "publish") {
        this.logRtmpAuthDecision("denied", input, {
          reason: "non-publish-action-not-handled-here",
          credentialSource,
        });
        return false;
      }

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
