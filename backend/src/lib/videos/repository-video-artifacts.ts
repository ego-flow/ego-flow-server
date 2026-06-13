import fs from "fs/promises";

import { VideoStatus } from "@prisma/client";

import {
  videosRepository,
  type ManagedRepositoryVideoRecord,
} from "../../repositories/videos.repository";
import type {
  RepositoryVideoDownloadResponse,
  RepositoryVideoSignedFileResponse,
} from "../../types/videos/response";
import { NotFound } from "../core/errors";
import { refreshRepositoryContributors } from "../repositories/repository-contributors";
import { isMissingFileError } from "../storage/file-system";
import { toSignedFileUrl } from "../storage/signed-file-url";
import { getTargetDirectory, toStorageRelativePath } from "../storage/storage";

const VIDEO_FILE_UNAVAILABLE_MESSAGE = "Video file is not available.";
const THUMBNAIL_FILE_UNAVAILABLE_MESSAGE = "Thumbnail file is not available.";

const ensureFileExists = async (filePath: string, missingMessage: string) => {
  try {
    await fs.stat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw NotFound(missingMessage);
    }

    throw error;
  }
};

export const buildRepositoryVideoDownloadResponse = async (
  video: ManagedRepositoryVideoRecord,
): Promise<RepositoryVideoDownloadResponse> => {
  if (!video.vlmVideoPath || video.status !== VideoStatus.COMPLETED) {
    throw NotFound(VIDEO_FILE_UNAVAILABLE_MESSAGE);
  }

  const targetDirectory = getTargetDirectory();
  await ensureFileExists(video.vlmVideoPath, VIDEO_FILE_UNAVAILABLE_MESSAGE);
  const redirectUrl = toSignedFileUrl(targetDirectory, video.vlmVideoPath);
  if (!redirectUrl) {
    throw NotFound(VIDEO_FILE_UNAVAILABLE_MESSAGE);
  }

  return {
    id: video.id,
    path: video.vlmVideoPath,
    sizeBytes: video.sizeBytes,
    sha256: video.vlmSha256,
    redirectUrl,
  };
};

export const buildRepositoryVideoThumbnailResponse = async (
  video: ManagedRepositoryVideoRecord,
): Promise<RepositoryVideoSignedFileResponse> => {
  if (!video.thumbnailPath) {
    throw NotFound(THUMBNAIL_FILE_UNAVAILABLE_MESSAGE);
  }

  const targetDirectory = getTargetDirectory();
  await ensureFileExists(video.thumbnailPath, THUMBNAIL_FILE_UNAVAILABLE_MESSAGE);
  const redirectUrl = toSignedFileUrl(targetDirectory, video.thumbnailPath);
  if (!redirectUrl) {
    throw NotFound(THUMBNAIL_FILE_UNAVAILABLE_MESSAGE);
  }

  return {
    redirectUrl,
  };
};

export const deleteManagedVideoFiles = async (video: ManagedRepositoryVideoRecord) => {
  const targetDirectory = getTargetDirectory();
  const filePaths = [
    video.vlmVideoPath,
    video.dashboardVideoPath,
    video.thumbnailPath,
  ];

  await Promise.all(
    filePaths.map(async (filePath) => {
      const relativePath = toStorageRelativePath(targetDirectory, filePath);
      if (!relativePath) {
        return;
      }

      await fs.rm(filePath as string, { force: true });
    }),
  );
};

export const deleteRepositoryVideoArtifactsAndRecord = async (
  repositoryId: string,
  video: ManagedRepositoryVideoRecord,
) => {
  await deleteManagedVideoFiles(video);
  await videosRepository.deleteVideo(video.id);
  await refreshRepositoryContributors(repositoryId);
};
