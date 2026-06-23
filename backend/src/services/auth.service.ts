import { RecordingSessionIngestType } from "@prisma/client";

import { AuthCredentialKind } from "../constants/auth/auth-constants";
import { ErrorCode, Unauthorized } from "../lib/core/errors";
import { signAccessToken } from "../lib/auth/access-token";
import { createDashboardSession, revokeDashboardSession } from "../lib/auth/dashboard-session";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import {
  getCurrentPythonToken as getCurrentPythonTokenCredential,
  issuePythonToken as issuePythonTokenCredential,
  revokePythonToken as revokePythonTokenCredential,
} from "../lib/auth/python-token";
import { userRepository } from "../repositories/user.repository";
import { mediaMtxAuthSchema } from "../schemas/auth.schema";
import type {
  ChangeMyPasswordInput,
  IssuePythonTokenInput,
  LoginInput,
  MediaMtxAuthInput,
} from "../types/auth/request";
import type { AppUserRole, AuthContext, AuthenticatedUser } from "../types/auth";
import { toAuthenticatedUserResponse, toCredentialUserResponse } from "../mappers/user.mapper";
import { streamOwnershipService } from "../lib/streaming/stream-ownership";
import { extractRepositoryNameFromStreamPath } from "../lib/streaming/stream-paths";

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
        repositoryName = extractRepositoryNameFromStreamPath(path);
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
    const user = await userRepository.findActivePasswordCredential(input.id);
    if (!user) {
      throw Unauthorized("Invalid id or password.", ErrorCode.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await verifyPassword(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw Unauthorized("Invalid id or password.", ErrorCode.INVALID_CREDENTIALS);
    }

    return {
      id: user.id,
      role: user.role,
      displayName: user.displayName,
    };
  }

  async loginApp(input: LoginInput) {
    const user = await this.authenticatePassword(input);
    const token = signAccessToken({
      userId: user.id,
      role: user.role,
    });

    return {
      token,
      user: toCredentialUserResponse(user),
    };
  }

  async loginDashboard(input: LoginInput & { remember_me?: boolean }) {
    const user = await this.authenticatePassword(input);
    const session = await createDashboardSession(user.id, Boolean(input.remember_me));

    return {
      session,
      user: toCredentialUserResponse(user),
    };
  }

  async logoutDashboard(auth: AuthContext | undefined) {
    if (auth?.kind === AuthCredentialKind.Dashboard && auth.rawCredential) {
      await revokeDashboardSession(auth.rawCredential);
    }

    return {
      logged_out: true,
    };
  }

  getDashboardSession(user: AuthenticatedUser) {
    return {
      user: toAuthenticatedUserResponse(user),
    };
  }

  async issuePythonToken(userId: string, input: IssuePythonTokenInput) {
    return issuePythonTokenCredential(userId, {
      name: input.name,
    });
  }

  async getCurrentPythonToken(userId: string) {
    return getCurrentPythonTokenCredential(userId);
  }

  validatePythonToken(user: AuthenticatedUser) {
    return {
      valid: true,
      user: toAuthenticatedUserResponse(user),
    };
  }

  async revokePythonToken(userId: string, userRole: AppUserRole, tokenId: string) {
    await revokePythonTokenCredential(userId, userRole, tokenId);
  }

  async authorizeMediaMtxRequest(payload: unknown): Promise<boolean> {
    const parsed = mediaMtxAuthSchema.safeParse(payload);
    if (!parsed.success) {
      const input = typeof payload === "object" && payload !== null ? (payload as Partial<MediaMtxAuthInput>) : {};
      console.warn("[mediamtx-auth] invalid payload", {
        action: input.action,
        path: input.path,
        protocol: input.protocol,
        user: input.user,
        id: input.id,
        ip: input.ip,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      });
      return false;
    }

    return this.authorizeMediaMtx(parsed.data);
  }

  private async authorizeMediaMtx(input: MediaMtxAuthInput): Promise<boolean> {
    if (input.action === "publish") {
      return this.verifyPublishAuthorization(input);
    }

    if (input.action === "read" && input.protocol === "hls") {
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

  async changeDashboardPassword(userId: string, input: ChangeMyPasswordInput) {
    const user = await userRepository.findActivePasswordCredential(userId);
    if (!user) {
      throw Unauthorized("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw Unauthorized("Current password is incorrect.", ErrorCode.INVALID_CREDENTIALS);
    }

    const nextPasswordHash = await hashPassword(input.newPassword);
    await userRepository.updatePasswordHash(userId, nextPasswordHash);

    return {
      message: "Password changed successfully",
    };
  }
}

export const authService = new AuthService();
