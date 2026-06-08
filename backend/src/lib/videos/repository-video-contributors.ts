import { repositoriesRepository } from "../../repositories/repositories.repository";
import { userRepository } from "../../repositories/user.repository";
import { videosRepository } from "../../repositories/videos.repository";
import type { RepositoryContributorSummary } from "../../types/videos/model";
import { normalizeContributorUserIds } from "../repositories/repository-contributors";

export const getDisplayNamesByUserId = async (userIds: string[]): Promise<Map<string, string>> => {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) {
    return new Map<string, string>();
  }

  const users = await userRepository.findSummaries(uniqueUserIds);
  return new Map(users.map((user) => [user.id, user.displayName]));
};

export const getRepositoryContributors = async (
  repositoryId: string,
): Promise<RepositoryContributorSummary[]> => {
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

  const displayNamesByUserId = await getDisplayNamesByUserId(Array.from(contributorsByUserId.keys()));

  return Array.from(contributorsByUserId.values())
    .map((contributor) => ({
      ...contributor,
      displayName: displayNamesByUserId.get(contributor.userId) ?? contributor.userId,
    }))
    .sort((left, right) => right.videoCount - left.videoCount || left.userId.localeCompare(right.userId));
};
