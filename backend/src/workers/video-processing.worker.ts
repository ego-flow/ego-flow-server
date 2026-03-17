import fs from "fs/promises";

import { VideoStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";

import { env } from "../config/env";
import { buildBullConnection } from "../lib/bullmq";
import { probeVideoMetadata } from "../lib/ffprobe";
import { prisma } from "../lib/prisma";
import type { VideoProcessingJobData } from "../types/stream";
import {
  buildOutputPaths,
  encodeDashboardVideo,
  encodeThumbnail,
  encodeVlmVideo,
  ensureOutputDirectories,
} from "./encoding";

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const waitForStableFile = async (filePath: string) => {
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

const updateVideoAsFailed = async (videoId: string, errorMessage: string) => {
  await prisma.video
    .update({
      where: { id: videoId },
      data: {
        status: VideoStatus.FAILED,
        errorMessage,
        processingCompletedAt: new Date(),
      },
    })
    .catch(() => {
      // Ignore secondary update failures.
    });
};

const processVideoJob = async (job: Job<VideoProcessingJobData, void, "video-processing">) => {
  const { videoId, videoKey, userId, rawRecordingPath, targetDirectory } = job.data;

  try {
    await job.updateProgress(5);

    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) {
      await job.log(`Video not found: ${videoId}`);
      return;
    }

    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: VideoStatus.PROCESSING,
        processingStartedAt: video.processingStartedAt ?? new Date(),
        errorMessage: null,
      },
    });

    await waitForStableFile(rawRecordingPath);
    await job.updateProgress(15);

    const metadata = await probeVideoMetadata(rawRecordingPath);
    await prisma.video.update({
      where: { id: videoId },
      data: {
        durationSec: metadata.durationSec,
        resolutionWidth: metadata.resolutionWidth,
        resolutionHeight: metadata.resolutionHeight,
        fps: metadata.fps,
        codec: metadata.codec,
        recordedAt: metadata.recordedAt,
      },
    });

    await job.updateProgress(35);

    const outputs = buildOutputPaths(targetDirectory, userId, videoKey, videoId);
    await ensureOutputDirectories(outputs);

    const thumbnailSeekSec = metadata.durationSec && metadata.durationSec > 2 ? metadata.durationSec / 2 : 1;

    await Promise.all([
      encodeVlmVideo(rawRecordingPath, outputs.vlmVideoPath),
      encodeDashboardVideo(rawRecordingPath, outputs.dashboardVideoPath),
      encodeThumbnail(rawRecordingPath, outputs.thumbnailPath, thumbnailSeekSec),
    ]);

    await job.updateProgress(90);

    await prisma.video.update({
      where: { id: videoId },
      data: {
        vlmVideoPath: outputs.vlmVideoPath,
        dashboardVideoPath: outputs.dashboardVideoPath,
        thumbnailPath: outputs.thumbnailPath,
        status: VideoStatus.COMPLETED,
        errorMessage: null,
        processingCompletedAt: new Date(),
      },
    });

    if (env.DELETE_RAW_AFTER_PROCESSING) {
      await fs.rm(rawRecordingPath, { force: true });
    }

    await job.updateProgress(100);
  } catch (error) {
    const message = formatErrorMessage(error);
    await updateVideoAsFailed(videoId, message);
    throw error;
  }
};

export const createVideoProcessingWorker = () => {
  const worker = new Worker<VideoProcessingJobData, void, "video-processing">(
    env.BULLMQ_QUEUE_NAME,
    processVideoJob,
    {
      connection: buildBullConnection(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on("active", (job) => {
    console.log(`[worker] active job=${job.id} videoId=${job.data.videoId}`);
  });

  worker.on("completed", (job) => {
    console.log(`[worker] completed job=${job.id} videoId=${job.data.videoId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[worker] failed job=${job?.id ?? "unknown"} videoId=${job?.data.videoId ?? "unknown"} error=${error.message}`,
    );
  });

  return worker;
};
