import { Queue } from "bullmq";

import { buildBullConnection } from "../lib/bullmq";
import type { RecordingFinalizeJobData } from "../types/stream";

const recordingFinalizeQueue = new Queue<RecordingFinalizeJobData, void, "recording-finalize">(
  "recording-finalize",
  { connection: buildBullConnection() },
);

export const buildRecordingFinalizeJobId = (recordingSessionId: string) => `finalize-${recordingSessionId}`;

/**
 * BullMQ 큐를 통해 비동기 처리 작업을 관리하는 서비스.
 * recording-finalize 큐에 후처리 job을 추가하고 진행 상태를 조회한다.
 */
export class ProcessingService {
  /**
   * [finalize job enqueue]
   * tryEnqueueFinalize에서 모든 조건이 충족되면 호출.
   * recording-finalize 큐에 job을 추가한다.
   * 동일 세션에 대해 중복 job이 생기지 않도록 jobId를 세션 ID 기반으로 생성한다.
   * 실패 시 최대 3회까지 exponential backoff(5초 시작)로 재시도한다.
   */
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
