import crypto from "crypto";
import { createReadStream } from "fs";
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

export const computeFileDigestAndSize = (
  filePath: string,
  algorithm: "sha256" = "sha256",
): Promise<{ sha256: string; sizeBytes: bigint }> =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = createReadStream(filePath);
    let sizeBytes = 0n;

    stream.on("data", (chunk: Buffer) => {
      sizeBytes += BigInt(chunk.length);
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolve({
        sha256: hash.digest("hex"),
        sizeBytes,
      });
    });
    stream.on("error", reject);
  });

export const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
