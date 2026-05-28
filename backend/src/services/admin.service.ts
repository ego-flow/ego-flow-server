import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { getConfigFilePath } from "../config/config.file";
import { getDotenvPath } from "../config/env";
import { runtimeConfig } from "../config/runtime";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getTargetDirectory } from "../lib/storage";
import type { CreateAdminUserInput, ResetUserPasswordInput } from "../schemas/admin.schema";
import type { AuthenticatedUser } from "../types/auth";

type ConfigValue = string | number | boolean | null;

const SECRET_PLACEHOLDER = "********";
const SECRET_EMPTY_PLACEHOLDER = "(not set)";

const maskConnectionUrl = (url: string | undefined): string => {
  if (!url) {
    return SECRET_EMPTY_PLACEHOLDER;
  }

  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? SECRET_PLACEHOLDER : "";
      parsed.password = parsed.password ? SECRET_PLACEHOLDER : "";
    }
    return parsed.toString();
  } catch {
    return SECRET_PLACEHOLDER;
  }
};

const maskSecretPresence = (value: string | undefined): string =>
  value && value.length > 0 ? SECRET_PLACEHOLDER : SECRET_EMPTY_PLACEHOLDER;

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
      throw NotFound("User not found.");
    }

    if (user.role === UserRole.admin) {
      throw BadRequest("Admin account cannot be permanently deleted.");
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
    const sections: Array<{
      title: string;
      description?: string;
      entries: Array<{
        key: string;
        value: ConfigValue;
        sensitive?: boolean;
        sourcePath?: string;
      }>;
    }> = [
      {
        title: "Runtime",
        description: "Node process environment loaded from .env.",
        entries: [
          { key: "NODE_ENV", value: runtimeConfig.NODE_ENV, sourcePath: getDotenvPath() },
          { key: "PORT", value: runtimeConfig.PORT, sourcePath: getDotenvPath() },
        ],
      },
      {
        title: "Storage",
        description: "Filesystem locations resolved at startup.",
        entries: [
          { key: "DATA_ROOT", value: runtimeConfig.DATA_ROOT, sourcePath: getConfigFilePath() },
          { key: "TARGET_DIRECTORY", value: getTargetDirectory(), sourcePath: getConfigFilePath() },
        ],
      },
      {
        title: "Ports",
        description: "Public-facing service ports.",
        entries: [
          { key: "PUBLIC_HTTP_PORT", value: runtimeConfig.PUBLIC_HTTP_PORT, sourcePath: getConfigFilePath() },
          { key: "RTMP_PORT", value: runtimeConfig.RTMP_PORT, sourcePath: getConfigFilePath() },
          { key: "RTMPS_PORT", value: runtimeConfig.RTMPS_PORT, sourcePath: getConfigFilePath() },
          { key: "HLS_PORT", value: runtimeConfig.HLS_PORT, sourcePath: getConfigFilePath() },
          { key: "WEBRTC_PORT", value: runtimeConfig.WEBRTC_PORT, sourcePath: getConfigFilePath() },
          { key: "MEDIAMTX_API_PORT", value: runtimeConfig.MEDIAMTX_API_PORT, sourcePath: getConfigFilePath() },
        ],
      },
      {
        title: "Streaming",
        description: "Endpoints handed out to publishers and players.",
        entries: [
          { key: "RTMP_BASE_URL", value: runtimeConfig.RTMP_BASE_URL, sourcePath: getDotenvPath() },
          { key: "WHIP_BASE_URL", value: runtimeConfig.WHIP_BASE_URL, sourcePath: getDotenvPath() },
          { key: "WHEP_BASE_URL", value: runtimeConfig.WHEP_BASE_URL, sourcePath: getDotenvPath() },
          { key: "HLS_PATH_PREFIX", value: runtimeConfig.HLS_PATH_PREFIX },
          { key: "WHIP_PATH_PREFIX", value: runtimeConfig.WHIP_PATH_PREFIX },
          { key: "WHEP_PATH_PREFIX", value: runtimeConfig.WHEP_PATH_PREFIX },
          { key: "MEDIAMTX_API_URL", value: runtimeConfig.MEDIAMTX_API_URL, sourcePath: getDotenvPath() },
        ],
      },
      {
        title: "RTMPS",
        description: "TLS settings for the secure RTMP listener.",
        entries: [
          { key: "RTMPS_ENABLED", value: runtimeConfig.RTMPS_ENABLED, sourcePath: getDotenvPath() },
          { key: "RTMPS_ENCRYPTION_MODE", value: runtimeConfig.RTMPS_ENCRYPTION_MODE, sourcePath: getDotenvPath() },
          { key: "RTMPS_CERT_PATH", value: runtimeConfig.RTMPS_CERT_PATH, sourcePath: getDotenvPath() },
          { key: "RTMPS_KEY_PATH", value: runtimeConfig.RTMPS_KEY_PATH, sourcePath: getDotenvPath() },
        ],
      },
      {
        title: "Sessions",
        description: "Auth, signed URL, and worker tuning.",
        entries: [
          { key: "JWT_EXPIRES_IN", value: runtimeConfig.JWT_EXPIRES_IN, sourcePath: getConfigFilePath() },
          { key: "JWT_REFRESH_THRESHOLD_SECONDS", value: runtimeConfig.JWT_REFRESH_THRESHOLD_SECONDS, sourcePath: getConfigFilePath() },
          { key: "SIGNED_FILE_URL_EXPIRES_IN", value: runtimeConfig.SIGNED_FILE_URL_EXPIRES_IN, sourcePath: getConfigFilePath() },
          { key: "WORKER_CONCURRENCY", value: runtimeConfig.WORKER_CONCURRENCY, sourcePath: getConfigFilePath() },
          { key: "DELETE_RAW_AFTER_PROCESSING", value: runtimeConfig.DELETE_RAW_AFTER_PROCESSING, sourcePath: getConfigFilePath() },
          { key: "CORS_ORIGIN", value: runtimeConfig.CORS_ORIGIN, sourcePath: getConfigFilePath() },
        ],
      },
      {
        title: "Secrets",
        description: "Credentials and connection strings (values are masked).",
        entries: [
          { key: "DATABASE_URL", value: maskConnectionUrl(runtimeConfig.DATABASE_URL), sensitive: true, sourcePath: getDotenvPath() },
          { key: "REDIS_URL", value: maskConnectionUrl(runtimeConfig.REDIS_URL), sensitive: true, sourcePath: getDotenvPath() },
          { key: "JWT_SECRET", value: maskSecretPresence(runtimeConfig.JWT_SECRET), sensitive: true, sourcePath: getDotenvPath() },
          { key: "ADMIN_DEFAULT_PASSWORD", value: maskSecretPresence(runtimeConfig.ADMIN_DEFAULT_PASSWORD), sensitive: true, sourcePath: getDotenvPath() },
          { key: "HF_TOKEN", value: maskSecretPresence(runtimeConfig.HF_TOKEN), sensitive: true, sourcePath: getDotenvPath() },
        ],
      },
    ];

    return {
      settings: {
        target_directory: getTargetDirectory(),
        config_path: getConfigFilePath(),
        dotenv_path: getDotenvPath(),
        sections: sections.map((section) => ({
          title: section.title,
          description: section.description ?? null,
          entries: section.entries.map((entry) => ({
            key: entry.key,
            value: entry.value,
            sensitive: Boolean(entry.sensitive),
            source_path: entry.sourcePath ?? null,
          })),
        })),
      },
    };
  }

  async createUser(input: CreateAdminUserInput) {
    const existingUser = await prisma.user.findUnique({
      where: { id: input.id },
      select: { id: true },
    });

    if (existingUser) {
      throw Conflict("User id already exists.");
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
      throw NotFound("User not found.");
    }

    if (user.role === UserRole.admin) {
      throw BadRequest("Admin account cannot be deactivated.");
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
      throw BadRequest("Deactivate the user before permanent deletion.");
    }

    if (
      state.checks.ownedRepositoryCount > 0 ||
      state.checks.repositoryMembershipCount > 0 ||
      state.checks.recordingSessionCount > 0
    ) {
      throw Conflict(
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
      throw NotFound("User not found.");
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
