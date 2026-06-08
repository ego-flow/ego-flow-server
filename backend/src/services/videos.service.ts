import { getTargetDirectory } from "../lib/storage/storage";
import {
  getManagedRepositoryVideo,
  getRepositoryVideoForResponse,
  getRepositoryVideoForStatus,
} from "../lib/videos/repository-video-access";
import {
  buildRepositoryVideoDownloadResponse,
  deleteRepositoryVideoArtifactsAndRecord,
} from "../lib/videos/repository-video-artifacts";
import {
  getDisplayNamesByUserId,
  getRepositoryContributors,
} from "../lib/videos/repository-video-contributors";
import {
  getProcessingProgressByVideoId,
  getRecordingFinalizeProgress,
  getRepositoryVideoProcessingProgress,
} from "../lib/videos/repository-video-progress";
import { findRepositoryVideosPage } from "../lib/videos/repository-video-query";
import {
  toRepositoryContributorResponse,
  toRepositoryVideoResponse,
  toRepositoryVideoStatusResponse,
} from "../mappers/video.mapper";
import type { RepoVideoListQueryInput } from "../types/videos/request";
import type { RepositoryVideoContext } from "../types/videos/model";
import type {
  RepositoryVideoDownloadResponse,
  RepositoryVideoListResponse,
  RepositoryVideoResponse,
  RepositoryVideoStatusResponse,
} from "../types/videos/response";

export class VideosService {
  async listRepositoryVideos(
    repository: RepositoryVideoContext,
    query: RepoVideoListQueryInput,
  ): Promise<RepositoryVideoListResponse> {
    const targetDirectory = getTargetDirectory();

    const [{ total, videos }, contributors] = await Promise.all([
      findRepositoryVideosPage(repository.id, query),
      getRepositoryContributors(repository.id),
    ]);

    const displayNamesByUserId = new Map(
      contributors.map((contributor) => [contributor.userId, contributor.displayName] as const),
    );
    const progressByVideoId = await getProcessingProgressByVideoId(videos);

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
    const video = await getRepositoryVideoForResponse(repoId, videoId);
    const contributorUserId = video.recorder;
    const displayNamesByUserId = await getDisplayNamesByUserId(contributorUserId ? [contributorUserId] : []);
    const processingProgress = await getRepositoryVideoProcessingProgress(video);

    return toRepositoryVideoResponse(targetDirectory, video, repository, displayNamesByUserId, {
      includeDashboardVideoUrl: true,
      processingProgress,
    });
  }

  async getRepositoryVideoStatus(repoId: string, videoId: string): Promise<RepositoryVideoStatusResponse> {
    const video = await getRepositoryVideoForStatus(repoId, videoId);
    const progress = await getRecordingFinalizeProgress(video.recordingSessionId);

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
    const video = await getManagedRepositoryVideo(repoId, videoId);

    return buildRepositoryVideoDownloadResponse(video);
  }

  async deleteRepositoryVideo(repoId: string, videoId: string) {
    const managedVideo = await getManagedRepositoryVideo(repoId, videoId);

    await deleteRepositoryVideoArtifactsAndRecord(repoId, managedVideo);

    return {
      id: managedVideo.id,
      deleted: true,
    };
  }
}

export const videosService = new VideosService();
