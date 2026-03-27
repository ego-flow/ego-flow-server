import fs from "fs/promises";
import path from "path";

import { env } from "../config/env";
import { prisma } from "./prisma";

const TARGET_DIRECTORY_SETTING_KEY = "target_directory";

let activeTargetDirectory = path.resolve(env.TARGET_DIRECTORY);

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isNestedPath = (parentPath: string, childPath: string): boolean => {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const remapStoredPath = (previousDirectory: string, nextDirectory: string, filePath: string | null): string | null => {
  if (!filePath) {
    return null;
  }

  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(previousDirectory, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return filePath;
  }

  return path.join(nextDirectory, relative);
};

const movePath = async (sourcePath: string, destinationPath: string) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "EXDEV") {
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: false });
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }

    throw error;
  }
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
  const videos = await prisma.video.findMany({
    where: {
      OR: [
        { vlmVideoPath: { startsWith: previousDirectory } },
        { dashboardVideoPath: { startsWith: previousDirectory } },
        { thumbnailPath: { startsWith: previousDirectory } },
      ],
    },
    select: {
      id: true,
      vlmVideoPath: true,
      dashboardVideoPath: true,
      thumbnailPath: true,
    },
  });

  await prisma.$transaction(
    videos.map((video) =>
      prisma.video.update({
        where: { id: video.id },
        data: {
          vlmVideoPath: remapStoredPath(previousDirectory, nextDirectory, video.vlmVideoPath),
          dashboardVideoPath: remapStoredPath(previousDirectory, nextDirectory, video.dashboardVideoPath),
          thumbnailPath: remapStoredPath(previousDirectory, nextDirectory, video.thumbnailPath),
        },
      }),
    ),
  );
};

export const initializeTargetDirectory = async (): Promise<string> => {
  const configuredTargetDirectory = path.resolve(env.TARGET_DIRECTORY);
  const setting = await prisma.setting.findUnique({
    where: { key: TARGET_DIRECTORY_SETTING_KEY },
    select: { value: true },
  });
  const previousTargetDirectory = setting?.value ? path.resolve(setting.value) : null;

  await fs.mkdir(configuredTargetDirectory, { recursive: true });

  if (previousTargetDirectory && previousTargetDirectory !== configuredTargetDirectory) {
    console.log(
      `[storage] migrating target_directory from ${previousTargetDirectory} to ${configuredTargetDirectory}`,
    );
    await migrateDirectoryContents(previousTargetDirectory, configuredTargetDirectory);
    await rewriteManagedVideoPaths(previousTargetDirectory, configuredTargetDirectory);
  }

  await prisma.setting.upsert({
    where: { key: TARGET_DIRECTORY_SETTING_KEY },
    update: { value: configuredTargetDirectory },
    create: {
      key: TARGET_DIRECTORY_SETTING_KEY,
      value: configuredTargetDirectory,
    },
  });

  activeTargetDirectory = configuredTargetDirectory;
  return activeTargetDirectory;
};

export const getTargetDirectory = (): string => activeTargetDirectory;

export const toFileUrl = (targetDirectory: string, filePath: string | null): string | null => {
  const relative = toStorageRelativePath(targetDirectory, filePath);
  if (!relative) {
    return null;
  }

  const encoded = relative.split(path.sep).map(encodeURIComponent).join("/");
  return `/files/${encoded}`;
};

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
