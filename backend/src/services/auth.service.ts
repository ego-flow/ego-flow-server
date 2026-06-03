import bcrypt from "bcryptjs";
import { RecordingSessionIngestType, UserRole } from "@prisma/client";

import { ErrorCode, Unauthorized } from "../lib/errors";
import { signAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";
import type { IssuePythonTokenInput, LoginInput, MediaMtxAuthInput } from "../schemas/auth.schema";
import type { ChangeMyPasswordInput } from "../schemas/user.schema";
import type { AppUserRole } from "../types/auth";
import { apiTokenService } from "./api-token.service";
import { streamOwnershipService } from "./stream-ownership.service";
import { streamService } from "./stream.service";
import { dashboardSessionService } from "./dashboard-session.service";

export class AuthService {
  private logMediaMtxAuthDecision(
    tag: "publish-auth" | "hls-auth",
    outcome: "allowed" | "denied",
    input: Partial<MediaMtxAuthInput>,
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
      console.info(`[${tag}] allowed`, payload);
      return;
    }

    console.warn(`[${tag}] denied`, payload);
  }

  private normalizeMediaMtxPath(path: string) {
    return path.trim().replace(/^\/+|\/+$/g, "");
  }

  private async authenticatePassword(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { id: input.id },
    });

    if (!user) {
      throw Unauthorized("Invalid id or password.", ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.deactivated) {
      throw Unauthorized("Invalid id or password.", ErrorCode.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw Unauthorized("Invalid id or password.", ErrorCode.INVALID_CREDENTIALS);
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

  async issuePythonToken(userId: string, input: IssuePythonTokenInput) {
    return apiTokenService.issueToken(userId, {
      name: input.name,
    });
  }

  async verifyMediaMtxAuthorization(input: MediaMtxAuthInput): Promise<boolean> {
    if (input.action === "publish") {
      return this.verifyPublishAuthorization(input);
    }

    if ((input.action === "read" || input.action === "playback") && input.protocol === "hls") {
      return this.verifyHlsPlaybackAuthorization(input);
    }

    this.logMediaMtxAuthDecision("hls-auth", "denied", input, {
      reason: "unsupported-mediamtx-action-or-protocol",
    });
    return false;
  }

  private async verifyPublishAuthorization(input: MediaMtxAuthInput): Promise<boolean> {
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
        this.logMediaMtxAuthDecision("publish-auth", "denied", input, {
          reason: "non-publish-action-not-handled-here",
          credentialSource,
        });
        return false;
      }

      if (input.password || input.token || queryParams.get("pass") || queryParams.get("token")) {
        this.logMediaMtxAuthDecision("publish-auth", "denied", input, {
          reason: "legacy-publish-credential-not-allowed",
          credentialSource,
          ticketId: publishTicketId,
        });
        return false;
      }

      const validation = await streamOwnershipService.validatePublishTicket(
        this.normalizeMediaMtxPath(input.path),
        publishTicketId,
        {
          expectedIngestType: RecordingSessionIngestType.MEDIAMTX,
        },
      );
      if (!validation.ok) {
        this.logMediaMtxAuthDecision("publish-auth", "denied", input, {
          reason: validation.reason,
          credentialSource,
          ticketId: validation.ticketId,
        });
        return false;
      }

      this.logMediaMtxAuthDecision("publish-auth", "allowed", input, {
        authenticatedUserId: validation.ticket.userId,
        recordingSessionId: validation.ticket.recordingSessionId,
        repositoryId: validation.ticket.repositoryId,
        credentialSource,
        ticketId: validation.ticketId,
      });
      return true;
    } catch (_error) {
      this.logMediaMtxAuthDecision("publish-auth", "denied", input, {
        reason: "exception",
      });
      return false;
    }
  }

  private async verifyHlsPlaybackAuthorization(input: MediaMtxAuthInput): Promise<boolean> {
    try {
      const ticketId = streamOwnershipService.extractHlsPlaybackTicketId({
        token: input.token,
        query: input.query,
        password: input.password,
      });
      const credentialSource = input.token
        ? "token"
        : new URLSearchParams(input.query ?? "").get("ticket")
          ? "query.ticket"
          : input.password
            ? "password"
            : null;

      const validation = await streamOwnershipService.validateHlsPlaybackTicket(
        this.normalizeMediaMtxPath(input.path),
        ticketId,
      );
      if (!validation.ok) {
        this.logMediaMtxAuthDecision("hls-auth", "denied", input, {
          reason: validation.reason,
          credentialSource,
          ticketId: validation.ticketId,
        });
        return false;
      }

      this.logMediaMtxAuthDecision("hls-auth", "allowed", input, {
        authenticatedUserId: validation.ticket.userId,
        recordingSessionId: validation.ticket.recordingSessionId,
        repositoryId: validation.ticket.repositoryId,
        credentialSource,
        ticketId: validation.ticketId,
      });
      return true;
    } catch (_error) {
      this.logMediaMtxAuthDecision("hls-auth", "denied", input, {
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
      throw Unauthorized("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
    }

    if (user.deactivated) {
      throw Unauthorized("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw Unauthorized("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
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
