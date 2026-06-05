import path from "path";

export const remapPathWithinDirectory = (
  previousDirectory: string,
  nextDirectory: string,
  filePath: string | null,
): string | null => {
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
