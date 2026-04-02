import fs from "fs/promises";
import path from "path";

import { Job, Worker } from "bullmq";
import { RecordingSessionStatus, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import { buildBullConnection } from "../lib/bullmq";
import { probeVideoMetadata } from "../lib/ffprobe";
import { prisma } from "../lib/prisma";
import { runtimeConfig as env } from "../config/runtime";
import { waitForStableFile, formatErrorMessage } from "../lib/file-utils";
import type { RecordingFinalizeJobData } from "../types/stream";
import {
  buildOutputPaths,
  concatSegments,
  encodeDashboardVideo,
  encodeThumbnail,
  encodeVlmVideo,
  ensureOutputDirectories,
} from "./encoding";

const processRecordingFinalize = async (job: Job<RecordingFinalizeJobData>) => {
  const { recordingSessionId, videoId, repositoryId, ownerId, repoName, targetDirectory } = job.data;

  const session = await prisma.recordingSession.findUnique({
    where: { id: recordingSessionId },
  });
  if (!session) {
    throw new Error(`Session ${recordingSessionId} not found`);
  }
  if (session.status === RecordingSessionStatus.COMPLETED) {
    console.log(`[finalize-worker] session ${recordingSessionId} already COMPLETED, skipping`);
    return;
  }
  if (session.status !== RecordingSessionStatus.FINALIZING) {
    throw new Error(`Session ${recordingSessionId} is not in FINALIZING state (current: ${session.status})`);
  }

  const segments = await prisma.recordingSegment.findMany({
    where: {
      recordingSessionId,
      status: RecordingSegmentStatus.COMPLETED,
    },
    orderBy: { sequence: "asc" },
  });

  if (segments.length === 0) {
    await prisma.$transaction([
      prisma.video.update({
        where: { id: videoId },
        data: { status: VideoStatus.FAILED, errorMessage: "No completed segments found" },
      }),
      prisma.recordingSession.update({
        where: { id: recordingSessionId },
        data: { status: RecordingSessionStatus.FAILED, finalizedAt: new Date() },
      }),
    ]);
    return;
  }

  await job.updateProgress(5);

  let rawInputPath: string;
  let mergedFilePath: string | null = null;

  if (segments.length === 1) {
    rawInputPath = segments[0]!.rawPath;
  } else {
    const concatDir = path.join(targetDirectory, ".tmp", recordingSessionId);
    await fs.mkdir(concatDir, { recursive: true });
    const concatListPath = path.join(concatDir, "concat.txt");
    mergedFilePath = path.join(concatDir, "merged.mp4");

    await concatSegments(
      segments.map((s) => s.rawPath),
      concatListPath,
      mergedFilePath,
    );
    rawInputPath = mergedFilePath;
  }

  await waitForStableFile(rawInputPath);
  await job.updateProgress(15);

  await prisma.video.update({
    where: { id: videoId },
    data: {
      status: VideoStatus.PROCESSING,
      rawRecordingPath: rawInputPath,
      processingStartedAt: new Date(),
    },
  });

  const metadata = await probeVideoMetadata(rawInputPath);
  await prisma.video.update({
    where: { id: videoId },
    data: {
      durationSec: metadata.durationSec,
      resolutionWidth: metadata.resolutionWidth,
      resolutionHeight: metadata.resolutionHeight,
      fps: metadata.fps,
      codec: metadata.codec,
      recordedAt: metadata.recordedAt,
      streamPath: session.streamPath,
      deviceType: session.deviceType,
    },
  });
  await job.updateProgress(35);

  const outputs = buildOutputPaths(targetDirectory, ownerId, repoName, videoId);
  await ensureOutputDirectories(outputs);

  const durationSec = metadata.durationSec ?? 0;
  const thumbnailSeekSec = durationSec > 2 ? durationSec / 2 : 1;

  await Promise.all([
    encodeVlmVideo(rawInputPath, outputs.vlmVideoPath),
    encodeDashboardVideo(rawInputPath, outputs.dashboardVideoPath),
    encodeThumbnail(rawInputPath, outputs.thumbnailPath, thumbnailSeekSec),
  ]);
  await job.updateProgress(90);

  await prisma.$transaction([
    prisma.video.update({
      where: { id: videoId },
      data: {
        vlmVideoPath: outputs.vlmVideoPath,
        dashboardVideoPath: outputs.dashboardVideoPath,
        thumbnailPath: outputs.thumbnailPath,
        status: VideoStatus.COMPLETED,
        errorMessage: null,
        processingCompletedAt: new Date(),
      },
    }),
    prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.COMPLETED,
        finalizedAt: new Date(),
      },
    }),
  ]);

  if (env.DELETE_RAW_AFTER_PROCESSING) {
    for (const segment of segments) {
      await fs.rm(segment.rawPath, { force: true }).catch(() => {});
    }
    if (mergedFilePath) {
      const concatDir = path.dirname(mergedFilePath);
      await fs.rm(concatDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  await job.updateProgress(100);
};

export const createRecordingFinalizeWorker = () => {
  const worker = new Worker<RecordingFinalizeJobData, void, "recording-finalize">(
    "recording-finalize",
    processRecordingFinalize,
    {
      connection: buildBullConnection(),
      concurrency: env.WORKER_CONCURRENCY,
    },
  );

  worker.on("active", (job) => {
    console.log(`[finalize-worker] active job=${job.id} session=${job.data.recordingSessionId}`);
  });

  worker.on("completed", (job) => {
    console.log(`[finalize-worker] completed job=${job.id} session=${job.data.recordingSessionId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[finalize-worker] failed job=${job?.id} error=${formatErrorMessage(error)}`);

    if (job?.data.recordingSessionId) {
      void prisma.recordingSession
        .findUnique({ where: { id: job.data.recordingSessionId }, select: { status: true } })
        .then((session) => {
          if (
            session?.status === RecordingSessionStatus.COMPLETED ||
            session?.status === RecordingSessionStatus.FAILED
          ) {
            return;
          }
          return prisma.$transaction([
            prisma.recordingSession.update({
              where: { id: job.data.recordingSessionId },
              data: { status: RecordingSessionStatus.FAILED, finalizedAt: new Date() },
            }),
            prisma.video.update({
              where: { id: job.data.videoId },
              data: { status: VideoStatus.FAILED, errorMessage: formatErrorMessage(error) },
            }),
          ]);
        })
        .catch(() => {});
    }
  });

  return worker;
};
