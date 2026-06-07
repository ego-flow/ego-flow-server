import { VideoStatus, type Prisma } from "@prisma/client";

import { videosRepository } from "../../repositories/videos.repository";
import type { ManifestQueryInput } from "../../types/repository/request";
import type { RepositoryAccessContext } from "../../types/repository";
import type { RepositoryManifestResponse } from "../../types/repository/response";
import { Internal } from "../core/errors";
import { toSignedFileUrl } from "../storage/signed-file-url";
import { getTargetDirectory } from "../storage/storage";

const toRepositoryThumbnailUrl = (targetDirectory: string, thumbnailPath: string): string => {
  const signedUrl = toSignedFileUrl(targetDirectory, thumbnailPath);
  if (!signedUrl) {
    throw Internal(`Thumbnail path is outside the configured storage directory.`);
  }

  return signedUrl;
};

const toRepositoryVideoDownloadUrl = (repositoryId: string, videoId: string) =>
  `/api/v1/repositories/${repositoryId}/videos/${videoId}/download`;

const getManifestArtifactMetadata = (video: {
  id: string;
  sizeBytes: bigint | null;
  vlmSha256: string | null;
}) => {
  if (video.sizeBytes === null || !video.vlmSha256) {
    throw Internal(`Manifest metadata is missing for completed video '${video.id}'.`);
  }

  return {
    size_bytes: Number(video.sizeBytes),
    sha256: video.vlmSha256,
  };
};

export const loadRepositoryManifest = async (
  access: RepositoryAccessContext,
  query: ManifestQueryInput,
): Promise<RepositoryManifestResponse> => {
  const targetDirectory = getTargetDirectory();
  const repository = access.repository;
  const where: Prisma.VideosWhereInput = {
    repositoryId: repository.id,
    status: VideoStatus.COMPLETED,
  };

  const [total, videos] = await Promise.all([
    videosRepository.countVideos(where),
    videosRepository.findManifestVideos({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    manifest_version: "1",
    repository: {
      id: repository.id,
      owner_id: repository.ownerId,
      name: repository.name,
      visibility: repository.visibility,
      my_role: access.effectiveRole,
    },
    default_artifact: "vlm_video",
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      has_next: query.page * query.limit < total,
    },
    videos: videos.map((video) => {
      const artifactMetadata = getManifestArtifactMetadata(video);

      return {
        video_id: video.id,
        recorded_at: video.recordedAt ? video.recordedAt.toISOString() : null,
        duration_sec: video.durationSec,
        resolution_width: video.resolutionWidth,
        resolution_height: video.resolutionHeight,
        fps: video.fps,
        codec: video.codec,
        scene_summary: video.semanticMetadata?.sceneSummary ?? null,
        clip_segments: video.semanticMetadata?.clipSegments ?? null,
        artifacts: {
          vlm_video: {
            download_url: toRepositoryVideoDownloadUrl(repository.id, video.id),
            ...artifactMetadata,
            content_type: "video/mp4",
          },
          thumbnail: video.thumbnailPath
            ? {
                download_url: toRepositoryThumbnailUrl(targetDirectory, video.thumbnailPath),
                content_type: "image/jpeg",
              }
            : null,
        },
      };
    }),
  };
};
