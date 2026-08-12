import fs from "fs/promises";
import path from "path";

import { TARGET_DIRECTORY_SETTING_KEY } from "../../constants/storage/storage-constants";
import { runtimeConfig as env } from "../../config/runtime";
import { settingRepository } from "../../repositories/setting.repository";
import { videosRepository } from "../../repositories/videos.repository";
import { movePath, pathExists } from "./file-system";
import { remapPathWithinDirectory } from "./path-mapping";

let activeTargetDirectory = path.resolve(env.TARGET_DIRECTORY);

const isNestedPath = (parentPath: string, childPath: string): boolean => {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const migrateDirectoryContents = async (previousDirectory: string, nextDirectory: string) => {
  if (previousDirectory === nextDirectory) {
    return;
  }

  if (isNestedPath(previousDirectory, nextDirectory) || isNestedPath(nextDirectory, previousDirectory)) {
    throw new Error("target_directory migration cannot move between nested directories.");
  }

  await fs.mkdir(nextDirectory, { recursive: true });

  if (!(await pathExists(previousDirectory))) {
    return;
  }

  const entries = await fs.readdir(previousDirectory);
  for (const entry of entries) {
    const sourcePath = path.join(previousDirectory, entry);
    const destinationPath = path.join(nextDirectory, entry);

    if (await pathExists(destinationPath)) {
      throw new Error(`target_directory migration aborted because destination already contains: ${destinationPath}`);
    }

    await movePath(sourcePath, destinationPath);
  }

  await fs.rm(previousDirectory, { recursive: true, force: true });
};

const rewriteManagedVideoPaths = async (previousDirectory: string, nextDirectory: string) => {
  const videos = await videosRepository.findManagedPathsStartingWith(previousDirectory);

  await videosRepository.updateManagedVideoPaths({
    videos: videos.map((video) => ({
      id: video.id,
      vlmVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.vlmVideoPath),
      dashboardVideoPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.dashboardVideoPath),
      thumbnailPath: remapPathWithinDirectory(previousDirectory, nextDirectory, video.thumbnailPath),
    })),
  });
};

export const initializeTargetDirectory = async (): Promise<string> => {
  const configuredTargetDirectory = path.resolve(env.TARGET_DIRECTORY);
  const previousTargetDirectoryValue = await settingRepository.findValue(TARGET_DIRECTORY_SETTING_KEY);
  const previousTargetDirectory = previousTargetDirectoryValue ? path.resolve(previousTargetDirectoryValue) : null;

  await fs.mkdir(configuredTargetDirectory, { recursive: true });

  if (previousTargetDirectory && previousTargetDirectory !== configuredTargetDirectory) {
    console.log(
      `[storage] migrating target_directory from ${previousTargetDirectory} to ${configuredTargetDirectory}`,
    );
    await migrateDirectoryContents(previousTargetDirectory, configuredTargetDirectory);
    await rewriteManagedVideoPaths(previousTargetDirectory, configuredTargetDirectory);
    await settingRepository.updateValue(TARGET_DIRECTORY_SETTING_KEY, configuredTargetDirectory);
  }

  if (!previousTargetDirectory) {
    await settingRepository.createValue(TARGET_DIRECTORY_SETTING_KEY, configuredTargetDirectory);
  }

  activeTargetDirectory = configuredTargetDirectory;
  return activeTargetDirectory;
};

export const getTargetDirectory = (): string => activeTargetDirectory;

export const toStorageRelativePath = (targetDirectory: string, filePath: string | null): string | null => {
  if (!filePath) {
    return null;
  }

  const base = path.resolve(targetDirectory);
  const resolved = path.resolve(filePath);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative;
};
