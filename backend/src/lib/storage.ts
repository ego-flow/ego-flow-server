import path from "path";

import { env } from "../config/env";
import { prisma } from "./prisma";

export const getTargetDirectory = async (): Promise<string> => {
  const setting = await prisma.setting.findUnique({ where: { key: "target_directory" } });
  return setting?.value || env.TARGET_DIRECTORY;
};

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
