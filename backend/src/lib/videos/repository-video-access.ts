import { videosRepository } from "../../repositories/videos.repository";
import { NotFound } from "../core/errors";

const assertRepositoryVideo = <T extends { repositoryId: string }>(
  repoId: string,
  video: T | null,
): T => {
  if (!video || video.repositoryId !== repoId) {
    throw NotFound("Video not found in this repository.");
  }

  return video;
};

export const getRepositoryVideoForResponse = async (repoId: string, videoId: string) => {
  const video = await videosRepository.findVideoForResponse(videoId);

  return assertRepositoryVideo(repoId, video);
};

export const getRepositoryVideoForStatus = async (repoId: string, videoId: string) => {
  const video = await videosRepository.findVideoForStatus(videoId);

  return assertRepositoryVideo(repoId, video);
};

export const getManagedRepositoryVideo = async (repoId: string, videoId: string) => {
  const video = await videosRepository.findManagedVideo(videoId);

  return assertRepositoryVideo(repoId, video);
};
