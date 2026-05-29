import fs from "fs/promises";

export const getNodeErrorCode = (error: unknown): string | null =>
  error instanceof Error && "code" in error ? String(error.code) : null;

export const isMissingFileError = (error: unknown) => getNodeErrorCode(error) === "ENOENT";

export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const movePath = async (sourcePath: string, destinationPath: string) => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (getNodeErrorCode(error) === "EXDEV") {
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: false });
      await fs.rm(sourcePath, { recursive: true, force: true });
      return;
    }

    throw error;
  }
};
