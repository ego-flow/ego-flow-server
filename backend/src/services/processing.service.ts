import { Queue } from "bullmq";

import { env } from "../config/env";
import type { VideoProcessingJobData } from "../types/stream";

const buildBullConnection = () => {
  const url = new URL(env.REDIS_URL);
  const db = Number(url.pathname.replace("/", "") || "0");

  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password || undefined,
    db,
    maxRetriesPerRequest: null,
  };
};

const processingQueue = new Queue<VideoProcessingJobData, void, "video-processing">(env.BULLMQ_QUEUE_NAME, {
  connection: buildBullConnection(),
});

export class ProcessingService {
  async enqueueVideoProcessing(payload: VideoProcessingJobData) {
    return processingQueue.add("video-processing", payload, {
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
