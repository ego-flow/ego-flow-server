import fs from "fs/promises";

import { Job, Worker } from "bullmq";
import { RecordingSessionStatus, RecordingSegmentStatus, VideoStatus } from "@prisma/client";

import { buildBullConnection } from "../lib/bullmq";
import { probeVideoMetadata } from "../lib/ffprobe";
import { prisma } from "../lib/prisma";
import { runtimeConfig as env } from "../config/runtime";
import { computeFileDigestAndSize, waitForStableFile, formatErrorMessage } from "../lib/file-utils";
import type { RecordingFinalizeJobData } from "../types/stream";
import {
  buildOutputPaths,
  encodeDashboardVideo,
  encodeThumbnail,
  encodeVlmVideo,
  ensureOutputDirectories,
} from "./encoding";
import { refreshRepositoryContributors } from "../services/repository-contributors.service";

const hasFinalizeAttemptsRemaining = (job: Job<RecordingFinalizeJobData>) => {
  const maxAttempts = job.opts?.attempts ?? 1;
  const attemptsMade = job.attemptsMade ?? 0;
  return attemptsMade + 1 < maxAttempts;
};

const resetRecordingSegmentForRetry = async (segmentId: string, recordingSessionId: string) => {
  const reset = await prisma.recordingSegment.updateMany({
    where: {
      id: segmentId,
      status: RecordingSegmentStatus.PROCESSING,
    },
    data: { status: RecordingSegmentStatus.WRITE_DONE },
  });

  if (reset.count !== 1) {
    console.warn(`[finalize-worker] segment retry reset missed session=${recordingSessionId}`);
  }
};

/**
 * [최종 비디오 생성 워커]
 * BullMQ recording-finalize 큐의 job을 처리하는 메인 함수.
 * 처리 흐름:
 * 1. session에 귀속된 단일 세그먼트 조회
 *    - 처리 가능한 상태는 WRITE_DONE만 허용
 *    - WRITE_DONE -> PROCESSING 전이를 atomic claim으로 사용
 * 2. raw 파일이 안정화될 때까지 대기
 * 3. ffprobe로 메타데이터(duration, resolution, fps 등) 추출
 * 4. VLM용 비디오, 대시보드용 비디오, 썸네일을 병렬로 인코딩
 * 5. Video를 생성하고 segment를 COMPLETED로 전환
 * 6. 설정에 따라 raw 세그먼트 파일 삭제
 */
const processRecordingFinalize = async (job: Job<RecordingFinalizeJobData>) => {
  const { recordingSessionId, videoId, repositoryId, ownerId, repoName, targetDirectory } = job.data;

  const session = await prisma.recordingSession.findUnique({
    where: { id: recordingSessionId },
  });
  if (!session) {
    throw new Error(`Session ${recordingSessionId} not found`);
  }
  if (session.status !== RecordingSessionStatus.CLOSED) {
    throw new Error(`Session ${recordingSessionId} is not in CLOSED state (current: ${session.status})`);
  }

  const currentVideo = await prisma.video.findUnique({
    where: { recordingSessionId },
    select: { status: true },
  });
  if (currentVideo) {
    console.log(`[finalize-worker] video for session ${recordingSessionId} already ${currentVideo.status}, skipping`);
    return;
  }

  const segment = await prisma.recordingSegment.findUnique({
    where: { recordingSessionId },
  });

  if (!segment || segment.status !== RecordingSegmentStatus.WRITE_DONE) {
    console.warn(`[finalize-worker] no processable segment found session=${recordingSessionId}`);
    return;
  }

  const claim = await prisma.recordingSegment.updateMany({
    where: {
      id: segment.id,
      status: RecordingSegmentStatus.WRITE_DONE,
    },
    data: { status: RecordingSegmentStatus.PROCESSING },
  });

  if (claim.count !== 1) {
    console.warn(`[finalize-worker] segment claim missed session=${recordingSessionId}`);
    return;
  }

  try {
    await job.updateProgress(5);

    const rawInputPath = segment.rawPath;
    await waitForStableFile(rawInputPath);
    await job.updateProgress(15);

    const metadata = await probeVideoMetadata(rawInputPath);
    const recordedAt = metadata.recordedAt ?? session.readyAt ?? session.createdAt;
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

    const { sizeBytes, sha256 } = await computeFileDigestAndSize(outputs.vlmVideoPath);
    await job.updateProgress(90);

    await prisma.$transaction(async (tx) => {
      await tx.video.create({
        data: {
          id: videoId,
          repositoryId,
          recordingSessionId,
          rawRecordingPath: rawInputPath,
          streamPath: session.streamPath,
          deviceType: session.deviceType,
          durationSec: metadata.durationSec,
          resolutionWidth: metadata.resolutionWidth,
          resolutionHeight: metadata.resolutionHeight,
          fps: metadata.fps,
          codec: metadata.codec,
          recordedAt,
          vlmVideoPath: outputs.vlmVideoPath,
          dashboardVideoPath: outputs.dashboardVideoPath,
          thumbnailPath: outputs.thumbnailPath,
          sizeBytes,
          vlmSizeBytes: sizeBytes,
          vlmSha256: sha256,
          recorder: session.userId,
          status: VideoStatus.COMPLETED,
          errorMessage: null,
          processingStartedAt: new Date(),
          processingCompletedAt: new Date(),
        },
      });
      await tx.recordingSegment.updateMany({
        where: {
          id: segment.id,
          status: RecordingSegmentStatus.PROCESSING,
        },
        data: { status: RecordingSegmentStatus.COMPLETED },
      });
      await refreshRepositoryContributors(repositoryId, tx);
    });

    if (env.DELETE_RAW_AFTER_PROCESSING) {
      await fs.rm(segment.rawPath, { force: true }).catch(() => {});
    }

    await job.updateProgress(100);
  } catch (error) {
    if (hasFinalizeAttemptsRemaining(job)) {
      await resetRecordingSegmentForRetry(segment.id, recordingSessionId);
    }

    throw error;
  }
};

const markRecordingFinalizeFailed = async (
  data: RecordingFinalizeJobData,
  errorMessage: string,
) => {
  const session = await prisma.recordingSession.findUnique({
    where: { id: data.recordingSessionId },
  });
  if (!session) {
    throw new Error(`Session ${data.recordingSessionId} not found`);
  }

  const segment = await prisma.recordingSegment.findUnique({
    where: { recordingSessionId: data.recordingSessionId },
  });
  if (!segment) {
    throw new Error(`Segment for session ${data.recordingSessionId} not found`);
  }

  await prisma.$transaction([
    prisma.recordingSegment.updateMany({
      where: {
        recordingSessionId: data.recordingSessionId,
      },
      data: { status: RecordingSegmentStatus.FAILED },
    }),
    prisma.video.create({
      data: {
        id: data.videoId,
        repositoryId: data.repositoryId,
        recordingSessionId: data.recordingSessionId,
        rawRecordingPath: segment.rawPath,
        streamPath: session.streamPath,
        deviceType: session.deviceType,
        status: VideoStatus.FAILED,
        errorMessage,
        processingStartedAt: new Date(),
        processingCompletedAt: new Date(),
      },
    }),
  ]);
};

/**
 * [finalize 워커 생성]
 * recording-finalize BullMQ 큐를 소비하는 Worker 인스턴스를 생성한다.
 * WORKER_CONCURRENCY 설정값만큼 병렬 처리가 가능하다.
 * job 최종 실패 시 처리 대상 segment와 Video를 FAILED로 전환한다.
 */
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
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        return;
      }

      void markRecordingFinalizeFailed(job.data, formatErrorMessage(error)).catch(() => {});
    }
  });

  return worker;
};
