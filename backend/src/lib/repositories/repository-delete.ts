import fs from "fs/promises";
import path from "path";

import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import { repoMemberRepository } from "../../repositories/repo-member.repository";
import { repositoriesRepository } from "../../repositories/repositories.repository";
import { runRepositoryTransaction } from "../../repositories/repository-transaction";
import { videosRepository } from "../../repositories/videos.repository";
import type { RepositoryRecord } from "../../types/repository";
import { getTargetDirectory } from "../storage/storage";

export const deleteRepositoryStorageArtifacts = async (
  repository: Pick<RepositoryRecord, "id" | "ownerId" | "name">,
): Promise<void> => {
  const videos = await videosRepository.findRepositoryVideoPaths(repository.id);

  await Promise.all(
    videos.flatMap((video) =>
      [video.rawRecordingPath, video.vlmVideoPath, video.dashboardVideoPath, video.thumbnailPath]
        .filter((filePath): filePath is string => Boolean(filePath))
        .map((filePath) => fs.rm(filePath, { force: true, recursive: true })),
    ),
  );

  const repositoryDir = path.join(getTargetDirectory(), repository.ownerId, repository.name);
  await fs.rm(repositoryDir, { recursive: true, force: true });
};

export const deleteRepositoryRecords = async (repositoryId: string): Promise<void> => {
  await runRepositoryTransaction(async (tx) => {
    await repoMemberRepository.deleteManyByRepositoryId(repositoryId, tx);
    await videosRepository.deleteManyByRepositoryId(repositoryId, tx);
    await recordingSegmentRepository.deleteManyByRepositoryId(repositoryId, tx);
    await recordingSessionRepository.deleteManyByRepositoryId(repositoryId, tx);
    await repositoriesRepository.deleteRepository(repositoryId, tx);
  });
};

export const permanentlyDeleteRepositoryData = async (
  repository: Pick<RepositoryRecord, "id" | "ownerId" | "name">,
): Promise<void> => {
  await deleteRepositoryStorageArtifacts(repository);
  await deleteRepositoryRecords(repository.id);
};
