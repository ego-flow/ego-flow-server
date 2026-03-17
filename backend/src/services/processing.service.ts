import { Queue } from "bullmq";

import { env } from "../config/env";
import { buildBullConnection } from "../lib/bullmq";
import type { VideoProcessingJobData } from "../types/stream";

const processingQueue = new Queue<VideoProcessingJobData, void, "video-processing">(env.BULLMQ_QUEUE_NAME, {
  connection: buildBullConnection(),
});

export class ProcessingService {
  async enqueueVideoProcessing(payload: VideoProcessingJobData) {
    return processingQueue.add("video-processing", payload, {
      jobId: `video:${payload.videoId}`,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: 1000,
      removeOnFail: 2000,
    });
  }
}

export const processingService = new ProcessingService();
