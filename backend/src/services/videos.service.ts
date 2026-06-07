import fs from "fs/promises";

import { VideoStatus, type Prisma } from "@prisma/client";

import { NotFound } from "../lib/core/errors";
import { isMissingFileError } from "../lib/storage/file-system";
import { toSignedFileUrl } from "../lib/storage/signed-file-url";
import { getTargetDirectory, toStorageRelativePath } from "../lib/storage/storage";
import {
  videosRepository,
  type RepositoryVideoRecord,
} from "../repositories/videos.repository";
import { repositoriesRepository } from "../repositories/repositories.repository";
import { userRepository } from "../repositories/user.repository";
import {
  type RecordingFinalizeProgress,
} from "../types/processing";
import { processingService } from "../lib/processing/processing-queue";
import { normalizeContributorUserIds, refreshRepositoryContributors } from "../lib/repositories/repository-contributors";
import {
  toRepositoryContributorResponse,
  toRepositoryVideoResponse,
  toRepositoryVideoStatusResponse,
} from "../mappers/video.mapper";
import type { RepoVideoListQueryInput, RepoVideoOrderQuery } from "../types/videos/request";
import type {
  RepositoryContributorSummary,
  RepositoryVideoContext,
  RepositoryVideoDownloadResponse,
  RepositoryVideoListResponse,
  RepositoryVideoResponse,
  RepositoryVideoStatusResponse,
} from "../types/videos/response";

const buildOrderBy = (query: RepoVideoOrderQuery): Prisma.VideoOrderByWithRelationInput => {
  switch (query.sort_by) {
    case "recorded_at":
      return { recordedAt: query.sort_order };
    case "duration_sec":
      return { durationSec: query.sort_order };
    case "size_bytes":
      return { sizeBytes: query.sort_order };
    default:
      return { recordedAt: query.sort_order };
  }
};

export class VideosService {
  private async getRepositoryVideoForResponse(repoId: string, videoId: string) {
    const video = await videosRepository.findVideoForResponse(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async getRepositoryVideoForStatus(repoId: string, videoId: string) {
    const video = await videosRepository.findVideoForStatus(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async getManagedRepositoryVideo(repoId: string, videoId: string) {
    const video = await videosRepository.findManagedVideo(videoId);

    if (!video || video.repositoryId !== repoId) {
      throw NotFound("Video not found in this repository.");
    }

    return video;
  }

  private async deleteManagedFiles(targetDirectory: string, filePaths: Array<string | null>) {
    await Promise.all(
      filePaths.map(async (filePath) => {
        const relativePath = toStorageRelativePath(targetDirectory, filePath);
        if (!relativePath) {
          return;
        }

        await fs.rm(filePath as string, { force: true });
      }),
    );
  }

  private async ensureFileExists(filePath: string, missingMessage: string) {
    try {
      await fs.stat(filePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw NotFound(missingMessage);
      }

      throw error;
    }
  }

  private async getUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
      return new Map<string, string>();
    }

    const users = await userRepository.findSummaries(uniqueUserIds);
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  private async getRepositoryContributors(repositoryId: string): Promise<RepositoryContributorSummary[]> {
    const contributors = await repositoriesRepository.findContributors(repositoryId);
    const contributorUserIds = normalizeContributorUserIds(contributors);

    if (contributorUserIds.length === 0) {
      return [];
    }

    const contributorVideos = await videosRepository.findContributorVideos(repositoryId, contributorUserIds);

    const contributorsByUserId = new Map<string, Omit<RepositoryContributorSummary, "displayName">>(
      contributorUserIds.map((userId) => [
        userId,
        {
          userId,
          videoCount: 0,
          latestRecordedAt: null,
        } satisfies Omit<RepositoryContributorSummary, "displayName">,
      ]),
    );
    for (const video of contributorVideos) {
      const userId = video.recorder;
      if (!userId) {
        continue;
      }

      const latestCandidate = video.recordedAt ?? video.createdAt;
      const current = contributorsByUserId.get(userId);
      if (!current) {
        continue;
      }

      current.videoCount += 1;
      if (
        latestCandidate &&
        (!current.latestRecordedAt || latestCandidate.getTime() > current.latestRecordedAt.getTime())
      ) {
        current.latestRecordedAt = latestCandidate;
      }
    }

    const displayNamesByUserId = await this.getUserDisplayNames(Array.from(contributorsByUserId.keys()));

    return Array.from(contributorsByUserId.values())
      .map((contributor) => ({
        ...contributor,
        displayName: displayNamesByUserId.get(contributor.userId) ?? contributor.userId,
      }))
      .sort((left, right) => right.videoCount - left.videoCount || left.userId.localeCompare(right.userId));
  }

  private async getProcessingProgressByVideoId(
    videos: Array<Pick<RepositoryVideoRecord, "id" | "recordingSessionId" | "status">>,
  ): Promise<Map<string, RecordingFinalizeProgress | null>> {
    const entries = await Promise.all(
      videos.map(async (video) => {
        const progress =
          video.status === VideoStatus.PROCESSING
            ? await processingService.getRecordingFinalizeProgress(video.recordingSessionId)
            : null;

        return [video.id, progress] as const;
      }),
    );

    return new Map(entries);
  }

  async listRepositoryVideos(
    repository: RepositoryVideoContext,
    query: RepoVideoListQueryInput,
  ): Promise<RepositoryVideoListResponse> {
    const targetDirectory = getTargetDirectory();
    const where: Prisma.VideoWhereInput = {
      repositoryId: repository.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contributor_user_id ? { recorder: query.contributor_user_id } : {}),
    };

    const [total, videos, contributors] = await Promise.all([
      videosRepository.countVideos(where),
      videosRepository.findVideos({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: buildOrderBy(query),
      }),
      this.getRepositoryContributors(repository.id),
    ]);

    const displayNamesByUserId = new Map(
      contributors.map((contributor) => [contributor.userId, contributor.displayName] as const),
    );
    const progressByVideoId = await this.getProcessingProgressByVideoId(videos);

    return {
      total,
      page: query.page,
      limit: query.limit,
      contributors: contributors.map(toRepositoryContributorResponse),
      data: videos.map((video) =>
        toRepositoryVideoResponse(targetDirectory, video, repository, displayNamesByUserId, {
          processingProgress: progressByVideoId.get(video.id) ?? null,
        }),
      ),
    };
  }

  async getRepositoryVideoDetail(
    repoId: string,
    repository: RepositoryVideoContext,
    videoId: string,
  ): Promise<RepositoryVideoResponse> {
    const targetDirectory = getTargetDirectory();
    const video = await this.getRepositoryVideoForResponse(repoId, videoId);
    const contributorUserId = video.recorder;
    const displayNamesByUserId = await this.getUserDisplayNames(contributorUserId ? [contributorUserId] : []);
    const processingProgress =
      video.status === VideoStatus.PROCESSING
        ? await processingService.getRecordingFinalizeProgress(video.recordingSessionId)
        : null;

    return toRepositoryVideoResponse(targetDirectory, video, repository, displayNamesByUserId, {
      includeDashboardVideoUrl: true,
      processingProgress,
    });
  }

  async getRepositoryVideoStatus(repoId: string, videoId: string): Promise<RepositoryVideoStatusResponse> {
    const video = await this.getRepositoryVideoForStatus(repoId, videoId);
    const progress = await processingService.getRecordingFinalizeProgress(video.recordingSessionId);

    return toRepositoryVideoStatusResponse({
      id: video.id,
      repositoryId: video.repositoryId,
      status: video.status,
      progress,
      errorMessage: video.errorMessage,
      processingStartedAt: video.processingStartedAt,
      processingCompletedAt: video.processingCompletedAt,
    });
  }

  async getRepositoryVideoDownload(repoId: string, videoId: string): Promise<RepositoryVideoDownloadResponse> {
    const video = await this.getManagedRepositoryVideo(repoId, videoId);

    if (!video.vlmVideoPath || video.status !== "COMPLETED") {
      throw NotFound("Video file is not available.");
    }

    const targetDirectory = getTargetDirectory();
    await this.ensureFileExists(video.vlmVideoPath, "Video file is not available.");
    const redirectUrl = toSignedFileUrl(targetDirectory, video.vlmVideoPath);
    if (!redirectUrl) {
      throw NotFound("Video file is not available.");
    }

    return {
      id: video.id,
      path: video.vlmVideoPath,
      sizeBytes: video.sizeBytes,
      sha256: video.vlmSha256,
      redirectUrl,
    };
  }

  async deleteRepositoryVideo(repoId: string, videoId: string) {
    const managedVideo = await this.getManagedRepositoryVideo(repoId, videoId);

    const targetDirectory = getTargetDirectory();
    await this.deleteManagedFiles(targetDirectory, [
      managedVideo.vlmVideoPath,
      managedVideo.dashboardVideoPath,
      managedVideo.thumbnailPath,
    ]);
    await videosRepository.deleteVideo(managedVideo.id);
    await refreshRepositoryContributors(repoId);

    return {
      id: managedVideo.id,
      deleted: true,
    };
  }
}

export const videosService = new VideosService();
