import { Queue } from "bullmq";

import { buildBullConnection } from "../lib/bullmq";
import type { RecordingFinalizeJobData } from "../types/stream";

const recordingFinalizeQueue = new Queue<RecordingFinalizeJobData, void, "recording-finalize">(
  "recording-finalize",
  { connection: buildBullConnection() },
);

export const buildRecordingFinalizeJobId = (recordingSessionId: string) => `finalize-${recordingSessionId}`;

export class ProcessingService {
  async enqueueRecordingFinalize(payload: RecordingFinalizeJobData) {
    return recordingFinalizeQueue.add("recording-finalize", payload, {
      jobId: buildRecordingFinalizeJobId(payload.recordingSessionId),
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5_000,
      },
      removeOnComplete: 1000,
      removeOnFail: 2000,
    });
  }

  async getRecordingFinalizeProgress(recordingSessionId: string | null): Promise<number | null> {
    if (!recordingSessionId) {
      return null;
    }

    const job = await recordingFinalizeQueue.getJob(buildRecordingFinalizeJobId(recordingSessionId));
    if (!job || typeof job.progress !== "number") {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(job.progress)));
  }
}

export const processingService = new ProcessingService();
