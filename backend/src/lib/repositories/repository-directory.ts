import fs from "fs/promises";
import path from "path";

import { videosRepository } from "../../repositories/videos.repository";
import { Conflict } from "../core/errors";
import { movePath, pathExists } from "../storage/file-system";
import { remapPathWithinDirectory } from "../storage/path-mapping";
import { getTargetDirectory } from "../storage/storage";

export const renameRepositoryDirectory = async (input: {
  ownerId: string;
  previousName: string;
  nextName: string;
  repositoryId: string;
}): Promise<void> => {
  const targetDirectory = getTargetDirectory();
  const previousDirectory = path.join(targetDirectory, input.ownerId, input.previousName);
  const nextDirectory = path.join(targetDirectory, input.ownerId, input.nextName);

  if (await pathExists(nextDirectory)) {
    throw Conflict("Target repository directory already exists.");
  }

  if (await pathExists(previousDirectory)) {
    await fs.mkdir(path.dirname(nextDirectory), { recursive: true });
    await movePath(previousDirectory, nextDirectory);
  }

  const videos = await videosRepository.findVideoPathsForRepositoryRename(input.repositoryId);

  await videosRepository.updateVideoPathsForRepositoryRename({
    videos: videos.map((video) => ({
      id: video.id,
      vlmVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.vlmVideoPath),
      dashboardVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.dashboardVideoPath),
      thumbnailPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.thumbnailPath),
    })),
  });
};
