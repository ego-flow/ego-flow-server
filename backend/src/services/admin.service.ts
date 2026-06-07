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
import { BadRequest, Conflict, NotFound } from "../lib/core/errors";
import { listActivePythonTokensForAdmin } from "../lib/auth/python-token";
import { getTargetDirectory } from "../lib/storage/storage";
import { toAdminSettingsEntryResponse, toAdminUserResponse } from "../mappers/admin.mapper";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import { repoMemberRepository } from "../repositories/repo-member.repository";
import { repositoriesRepository } from "../repositories/repositories.repository";
import { userRepository } from "../repositories/user.repository";
import type { CreateAdminUserInput, ResetUserPasswordInput } from "../types/admin/request";
import type { AdminSettingsEntry } from "../types/admin/response";

const maskSecretValue = (value: string | undefined): string => {
  if (!value) {
    return "(not set)";
  }

  if (value.length === 1) {
    return "*";
  }

  return `${value[0]}**${value[value.length - 1]}`;
};

const resolveDisplayName = (userId: string, displayName: string | undefined) => {
  const normalized = displayName?.trim();
  return normalized || userId;
};

export class AdminService {
  private async getPermanentDeleteState(userId: string) {
    const user = await userRepository.findDeletionState(userId);

    if (!user) {
      throw NotFound("User not found.");
    }

    if (user.role === UserRole.admin) {
      throw BadRequest("Admin account cannot be permanently deleted.");
    }

    const [ownedRepositoryIds, memberRepositoryIds, recordingSessionCount] = await Promise.all([
      repositoriesRepository.findRepositoryIdsByOwner(user.id),
      repoMemberRepository.findRepositoryIdsByUser(user.id),
      recordingSessionRepository.countByParticipantUserId(user.id),
    ]);

    const ownedRepositoryIdSet = new Set(ownedRepositoryIds);
    const repositoryMembershipCount = memberRepositoryIds.filter(
      (repositoryId) => !ownedRepositoryIdSet.has(repositoryId),
    ).length;
    const checks = {
      isDeactivated: user.deactivated,
      ownedRepositoryCount: ownedRepositoryIds.length,
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
      entries: AdminSettingsEntry[];
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
        description: "Stack port map.",
        entries: [
          {
            key: `${FIXED_PUBLIC_HTTP_PORT}/tcp`,
            value: "Dashboard, API, WHIP routing",
            children: [
              { key: "backend:3000/tcp", value: "Backend API" },
              { key: "dashboard:8088/tcp", value: "Dashboard UI" },
              { key: `mediamtx:${FIXED_WHIP_PORT}/tcp`, value: "WHIP signaling" },
            ],
          },
          { key: `${FIXED_RTMP_PORT}/tcp`, value: "RTMP ingest" },
          {
            key: `${FIXED_RTMPS_PORT}/tcp`,
            value: "RTMPS ingest",
          },
          { key: `${FIXED_HLS_PORT}/tcp`, value: "HLS playback" },
          { key: `${FIXED_WEBRTC_UDP_PORT}/udp`, value: "WebRTC media" },
          {
            key: "internal-only",
            value: "Docker network only",
            children: [
              {
                key: `mediamtx:${FIXED_MEDIAMTX_API_PORT}/tcp`,
                value: "MediaMTX control API",
              },
              { key: `postgres:${FIXED_POSTGRES_PORT}/tcp`, value: "PostgreSQL" },
              { key: `redis:${FIXED_REDIS_PORT}/tcp`, value: "Redis, BullMQ" },
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

    return {
      settings: {
        target_directory: getTargetDirectory(),
        config_path: getConfigFilePath(),
        dotenv_path: getDotenvPath(),
        sections: sections.map((section) => ({
          title: section.title,
          description: section.description ?? null,
          entries: section.entries.map(toAdminSettingsEntryResponse),
        })),
      },
    };
  }

  async createUser(input: CreateAdminUserInput) {
    const existingUser = await userRepository.findUserId(input.id);

    if (existingUser) {
      throw Conflict("User id already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const displayName = resolveDisplayName(input.id, input.displayName);
    const user = await userRepository.createAdminManagedUser({
      id: input.id,
      passwordHash,
      displayName,
    });

    return {
      user: toAdminUserResponse(user),
    };
  }

  async listUsers() {
    const users = await userRepository.findAllForAdmin();

    return {
      users: users.map(toAdminUserResponse),
    };
  }

  async listPythonTokens() {
    const tokens = await listActivePythonTokensForAdmin();

    return {
      tokens,
    };
  }

  async deactivateUser(userId: string) {
    const user = await userRepository.findDeletionState(userId);

    if (!user) {
      throw NotFound("User not found.");
    }

    if (user.role === UserRole.admin) {
      throw BadRequest("Admin account cannot be deactivated.");
    }

    await userRepository.markDeactivated(user.id);

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

    await userRepository.deleteUser(state.user.id);

    return {
      id: state.user.id,
      deleted: true,
    };
  }

  async resetUserPassword(userId: string, input: ResetUserPasswordInput) {
    const user = await userRepository.findUserId(userId);

    if (!user) {
      throw NotFound("User not found.");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await userRepository.updatePasswordHash(user.id, passwordHash);

    return {
      id: user.id,
      passwordReset: true,
    };
  }

}

export const adminService = new AdminService();
