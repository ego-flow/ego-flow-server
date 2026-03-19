import { Queue } from "bullmq";

import { env } from "../config/env";
import { buildBullConnection } from "../lib/bullmq";
import type { VideoProcessingJobData } from "../types/stream";

const processingQueue = new Queue<VideoProcessingJobData, void, "video-processing">(env.BULLMQ_QUEUE_NAME, {
  connection: buildBullConnection(),
});

export const buildVideoProcessingJobId = (videoId: string) => `video-${videoId}`;

export class ProcessingService {
  async enqueueVideoProcessing(payload: VideoProcessingJobData) {
    return processingQueue.add("video-processing", payload, {
      jobId: buildVideoProcessingJobId(payload.videoId),
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: 1000,
      removeOnFail: 2000,
    });
  }

  async getVideoProcessingProgress(videoId: string): Promise<number | null> {
    const job = await processingQueue.getJob(buildVideoProcessingJobId(videoId));
    if (!job || typeof job.progress !== "number") {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(job.progress)));
  }
}

export const processingService = new ProcessingService();
