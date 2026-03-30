import fs from "fs/promises";

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForStableFile = async (filePath: string) => {
  let lastSize = -1;
  let stableCount = 0;

  for (let i = 0; i < 30; i += 1) {
    const stat = await fs.stat(filePath);
    if (stat.size > 0 && stat.size === lastSize) {
      stableCount += 1;
    } else {
      stableCount = 0;
      lastSize = stat.size;
    }

    if (stableCount >= 2) {
      return;
    }

    await sleep(500);
  }

  throw new Error(`Raw recording file is not stable yet: ${filePath}`);
};

export const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
