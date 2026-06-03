import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

import { fileConfig, getConfigFilePath } from "../config/config.file";
import { env, getDotenvPath } from "../config/env";
import {
  FIXED_HLS_PORT,
  FIXED_MEDIAMTX_API_PORT,
  FIXED_POSTGRES_PORT,
  FIXED_PUBLIC_HTTP_PORT,
  FIXED_REDIS_PORT,
  FIXED_RTMP_PORT,
  FIXED_RTMPS_PORT,
  FIXED_WEBRTC_UDP_PORT,
  FIXED_WHIP_PORT,
} from "../constants/config/config-constants";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { getTargetDirectory } from "../lib/storage";
import type { CreateAdminUserInput, ResetUserPasswordInput } from "../schemas/admin.schema";
import type { AuthenticatedUser } from "../types/auth";

type ConfigValue = string | number | boolean | null;

type SettingsEntry = {
  key: string;
  value: ConfigValue;
  sensitive?: boolean;
  sourcePath?: string;
  children?: SettingsEntry[];
};

type SettingsEntryResponse = {
  key: string;
  value: ConfigValue;
  sensitive: boolean;
  source_path: string | null;
  children: SettingsEntryResponse[];
};

const maskSecretValue = (value: string | undefined): string => {
  if (!value) {
    return "(not set)";
  }

  if (value.length === 1) {
    return "*";
  }

  return `${value[0]}**${value[value.length - 1]}`;
};

const toUserRole = (role: UserRole): "admin" | "user" => (role === UserRole.admin ? "admin" : "user");

const resolveDisplayName = (userId: string, displayName: string | undefined) => {
  const normalized = displayName?.trim();
  return normalized || userId;
};

const toUserResponse = (user: {
  id: string;
  role: UserRole;
  displayName: string;
  createdAt: Date;
  deactivated: boolean;
}) => ({
  id: user.id,
  role: toUserRole(user.role),
  displayName: user.displayName,
  createdAt: user.createdAt.toISOString(),
  deactivated: user.deactivated,
});

export class AdminService {
  private async getPermanentDeleteState(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivated: true,
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
      isDeactivated: user.deactivated,
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
      entries: SettingsEntry[];
    }> = [
      {
        title: "config.json",
        description: "Values loaded from config.json.",
        entries: [
          { key: "TARGET_DIRECTORY", value: fileConfig.TARGET_DIRECTORY, sourcePath: getConfigFilePath() },
          { key: "CORS_ORIGIN", value: fileConfig.CORS_ORIGIN, sourcePath: getConfigFilePath() },
          { key: "WORKER_CONCURRENCY", value: fileConfig.WORKER_CONCURRENCY, sourcePath: getConfigFilePath() },
          { key: "DELETE_RAW_AFTER_PROCESSING", value: fileConfig.DELETE_RAW_AFTER_PROCESSING, sourcePath: getConfigFilePath() },
          { key: "JWT_EXPIRES_IN", value: fileConfig.JWT_EXPIRES_IN, sourcePath: getConfigFilePath() },
          {
            key: "JWT_REFRESH_THRESHOLD_SECONDS",
            value: fileConfig.JWT_REFRESH_THRESHOLD_SECONDS,
            sourcePath: getConfigFilePath(),
          },
          {
            key: "SIGNED_FILE_URL_EXPIRES_IN",
            value: fileConfig.SIGNED_FILE_URL_EXPIRES_IN,
            sourcePath: getConfigFilePath(),
          },
        ],
      },
      {
        title: "Ports",
        description: "Public host ports, Caddy-routed internal service ports, and internal-only stack ports.",
        entries: [
          {
            key: `${FIXED_PUBLIC_HTTP_PORT}/tcp`,
            value: "Caddy public HTTP entrypoint for dashboard, API, and WHIP signaling",
            children: [
              { key: "backend:3000/tcp", value: "Backend API, Swagger UI, OpenAPI JSON, signed files" },
              { key: "dashboard:8088/tcp", value: "Dashboard web UI" },
              { key: `mediamtx:${FIXED_WHIP_PORT}/tcp`, value: "WHIP publish signaling via /live/*/whip" },
            ],
          },
          { key: `${FIXED_RTMP_PORT}/tcp`, value: "MediaMTX RTMP ingest endpoint for publisher connections" },
          {
            key: `${FIXED_RTMPS_PORT}/tcp`,
            value: "MediaMTX RTMPS ingest endpoint for encrypted publisher connections; optional unless RTMPS is enabled",
          },
          { key: `${FIXED_HLS_PORT}/tcp`, value: "Direct MediaMTX HLS playback endpoint" },
          { key: `${FIXED_WEBRTC_UDP_PORT}/udp`, value: "MediaMTX WHIP/WebRTC ICE media UDP endpoint" },
          {
            key: "internal-only",
            value: "Ports used only inside the Docker network; do not expose these in the server firewall",
            children: [
              {
                key: `mediamtx:${FIXED_MEDIAMTX_API_PORT}/tcp`,
                value: "MediaMTX control API used internally by backend to inspect active paths and service state",
              },
              { key: `postgres:${FIXED_POSTGRES_PORT}/tcp`, value: "PostgreSQL database, internal stack access only" },
              { key: `redis:${FIXED_REDIS_PORT}/tcp`, value: "Redis cache and BullMQ backend, internal stack access only" },
            ],
          },
        ],
      },
      {
        title: ".env",
        description: "Values loaded from .env. Secret values are masked.",
        entries: [
          { key: "NODE_ENV", value: env.NODE_ENV, sourcePath: getDotenvPath() },
          { key: "PORT", value: env.PORT, sourcePath: getDotenvPath() },
          { key: "DATABASE_URL", value: maskSecretValue(env.DATABASE_URL), sensitive: true, sourcePath: getDotenvPath() },
          { key: "JWT_SECRET", value: maskSecretValue(env.JWT_SECRET), sensitive: true, sourcePath: getDotenvPath() },
          {
            key: "ADMIN_DEFAULT_PASSWORD",
            value: maskSecretValue(env.ADMIN_DEFAULT_PASSWORD),
            sensitive: true,
            sourcePath: getDotenvPath(),
          },
          { key: "HF_TOKEN", value: maskSecretValue(env.HF_TOKEN), sensitive: true, sourcePath: getDotenvPath() },
          { key: "RTMPS_ENCRYPTION_MODE", value: env.RTMPS_ENCRYPTION_MODE ?? null, sourcePath: getDotenvPath() },
          { key: "RTMPS_CERT_PATH", value: env.RTMPS_CERT_PATH ?? null, sourcePath: getDotenvPath() },
          { key: "RTMPS_KEY_PATH", value: env.RTMPS_KEY_PATH ?? null, sourcePath: getDotenvPath() },
        ],
      },
    ];

    const toSettingsEntryResponse = (entry: SettingsEntry): SettingsEntryResponse => ({
      key: entry.key,
      value: entry.value,
      sensitive: Boolean(entry.sensitive),
      source_path: entry.sourcePath ?? null,
      children: (entry.children ?? []).map(toSettingsEntryResponse),
    });

    return {
      settings: {
        target_directory: getTargetDirectory(),
        config_path: getConfigFilePath(),
        dotenv_path: getDotenvPath(),
        sections: sections.map((section) => ({
          title: section.title,
          description: section.description ?? null,
          entries: section.entries.map(toSettingsEntryResponse),
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
    const displayName = resolveDisplayName(input.id, input.displayName);
    const user = await prisma.user.create({
      data: {
        id: input.id,
        passwordHash,
        role: UserRole.user,
        deactivated: false,
        displayName,
      },
      select: {
        id: true,
        role: true,
        displayName: true,
        createdAt: true,
        deactivated: true,
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
        deactivated: true,
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
        deactivated: true,
      },
    });

    return {
      id: user.id,
      deactivated: true,
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
        deactivated: true,
        displayName: true,
      },
    });

    if (!user || user.deactivated) {
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
