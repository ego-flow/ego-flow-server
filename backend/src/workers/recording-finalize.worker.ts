import fs from "fs/promises";

import { Job, Worker } from "bullmq";

import { buildBullConnection } from "../lib/infra/bullmq";
import { probeVideoMetadata } from "../lib/media/ffprobe";
import { runPrismaTransaction } from "../lib/infra/prisma";
import { runtimeConfig as env } from "../config/runtime";
import { computeFileDigestAndSize, waitForStableFile, formatErrorMessage } from "../lib/storage/file-utils";
import type { RecordingFinalizeJobData } from "../types/stream";
import {
  buildOutputPaths,
  encodeDashboardVideo,
  encodeThumbnail,
  encodeVlmVideo,
  ensureOutputDirectories,
} from "./encoding";
import { refreshRepositoryContributors } from "../lib/repositories/repository-contributors";
import { recordingSegmentRepository } from "../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import { videosRepository } from "../repositories/videos.repository";
import { videoSemanticMetadataRepository } from "../repositories/video-semantic-metadata.repository";
import { buildRecordingFinalizeProgress } from "../types/processing";

const hasFinalizeAttemptsRemaining = (job: Job<RecordingFinalizeJobData>) => {
  const maxAttempts = job.opts?.attempts ?? 1;
  const attemptsMade = job.attemptsMade ?? 0;
  return attemptsMade + 1 < maxAttempts;
};

const resetRecordingSegmentForRetry = async (segmentId: string, recordingSessionId: string) => {
  const reset = await recordingSegmentRepository.resetProcessingToWriteDone(segmentId);
  if (!reset) {
    console.warn(`[finalize-worker] segment retry reset missed session=${recordingSessionId}`);
  }
};

const upsertProcessingVideo = async (
  data: RecordingFinalizeJobData,
  session: NonNullable<Awaited<ReturnType<typeof recordingSessionRepository.findById>>>,
  segment: NonNullable<Awaited<ReturnType<typeof recordingSegmentRepository.findByRecordingSessionId>>>,
) => {
  const processingStartedAt = new Date();
  const fallbackRecordedAt = session.readyAt ?? session.createdAt;

  await videosRepository.upsertFinalizeProcessing({
    videoId: data.videoId,
    repositoryId: data.repositoryId,
    recordingSessionId: data.recordingSessionId,
    rawRecordingPath: segment.rawPath,
    streamPath: session.streamPath,
    deviceType: session.deviceType,
    recordedAt: fallbackRecordedAt,
    recorder: session.userId,
    processingStartedAt,
  });
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
 * 5. Video를 upsert하고 semantic metadata row를 PENDING으로 준비
 * 6. segment를 COMPLETED로 전환
 * 7. 설정에 따라 raw 세그먼트 파일 삭제
 */
const processRecordingFinalize = async (job: Job<RecordingFinalizeJobData>) => {
  const { recordingSessionId, videoId, repositoryId, ownerId, repoName, targetDirectory } = job.data;

  const session = await recordingSessionRepository.findById(recordingSessionId);
  if (!session) {
    throw new Error(`Session ${recordingSessionId} not found`);
  }

  const segment = await recordingSegmentRepository.findByRecordingSessionId(recordingSessionId);
  if (!segment) {
    console.warn(`[finalize-worker] no segment found session=${recordingSessionId}`);
    return;
  }

  const claim = await recordingSegmentRepository.claimProcessing(segment.id);
  if (!claim) {
    console.warn(`[finalize-worker] segment claim missed session=${recordingSessionId}`);
    return;
  }

  try {
    await job.updateProgress(buildRecordingFinalizeProgress("initialize_video"));
    await upsertProcessingVideo(job.data, session, segment);

    const rawInputPath = segment.rawPath;
    await job.updateProgress(buildRecordingFinalizeProgress("stabilize_raw"));
    await waitForStableFile(rawInputPath);

    await job.updateProgress(buildRecordingFinalizeProgress("probe_metadata"));
    const metadata = await probeVideoMetadata(rawInputPath);
    const recordedAt = metadata.recordedAt ?? session.readyAt ?? session.createdAt;

    await job.updateProgress(buildRecordingFinalizeProgress("prepare_outputs"));
    const outputs = buildOutputPaths(targetDirectory, ownerId, repoName, videoId);
    await ensureOutputDirectories(outputs);

    const durationSec = metadata.durationSec ?? 0;
    const thumbnailSeekSec = durationSec > 2 ? durationSec / 2 : 1;

    await job.updateProgress(buildRecordingFinalizeProgress("encode_assets"));
    await Promise.all([
      encodeVlmVideo(rawInputPath, outputs.vlmVideoPath),
      encodeDashboardVideo(rawInputPath, outputs.dashboardVideoPath),
      encodeThumbnail(rawInputPath, outputs.thumbnailPath, thumbnailSeekSec),
    ]);

    await job.updateProgress(buildRecordingFinalizeProgress("verify_artifact"));
    const { sizeBytes, sha256 } = await computeFileDigestAndSize(outputs.vlmVideoPath);

    await job.updateProgress(buildRecordingFinalizeProgress("persist_video"));
    await runPrismaTransaction(async (tx) => {
      const processedAt = new Date();
      const video = await videosRepository.upsertFinalizeCompleted({
        videoId,
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
        vlmSha256: sha256,
        recorder: session.userId,
        processedAt,
      }, tx);
      await videoSemanticMetadataRepository.upsertPending(video.id, tx);
      await recordingSegmentRepository.markCompletedIfProcessing(segment.id, tx);
      await refreshRepositoryContributors(repositoryId, tx);
    });

    if (env.DELETE_RAW_AFTER_PROCESSING) {
      await fs.rm(segment.rawPath, { force: true }).catch(() => {});
    }
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
  const session = await recordingSessionRepository.findById(data.recordingSessionId);
  if (!session) {
    throw new Error(`Session ${data.recordingSessionId} not found`);
  }

  const segment = await recordingSegmentRepository.findByRecordingSessionId(data.recordingSessionId);
  if (!segment) {
    throw new Error(`Segment for session ${data.recordingSessionId} not found`);
  }

  const processedAt = new Date();
  await runPrismaTransaction(async (tx) => {
    await recordingSegmentRepository.markFailedForFinalize(data.recordingSessionId, tx);
    await videosRepository.upsertFinalizeFailed({
      videoId: data.videoId,
      repositoryId: data.repositoryId,
      recordingSessionId: data.recordingSessionId,
      rawRecordingPath: segment.rawPath,
      streamPath: session.streamPath,
      deviceType: session.deviceType,
      errorMessage,
      processedAt,
    }, tx);
  });
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
