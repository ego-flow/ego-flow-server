import { randomUUID } from "node:crypto";

import { RecordingSegmentStatus, RecordingSessionStatus } from "@prisma/client";

import { processingService } from "../processing/processing-queue";
import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type { RecordingFinalizeJobData } from "../../types/stream";
import { extractRepositoryNameFromStreamPath } from "./stream-paths";

export const tryEnqueueRecordingFinalize = async (
  recordingSessionId: string,
): Promise<boolean> => {
  const session = await recordingSessionRepository.findById(recordingSessionId);
  if (!session || session.status !== RecordingSessionStatus.CLOSED) {
    return false;
  }

  const segment = await recordingSegmentRepository.findFinalizeStateByRecordingSessionId(recordingSessionId);

  if (!segment) {
    console.info("[rtmp-finalize] no-recording-segment", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
      endReason: session.endReason ?? null,
    });
    return false;
  }

  if (segment.status === RecordingSegmentStatus.WRITING) {
    console.info("[rtmp-finalize] waiting-for-segment-complete", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
      rawPath: segment.rawPath,
    });
    return false;
  }

  if (segment.status !== RecordingSegmentStatus.WRITE_DONE) {
    console.info("[rtmp-finalize] segment-not-ready", {
      recordingSessionId,
      repositoryId: session.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(session.streamPath),
      segmentStatus: segment.status,
    });
    return false;
  }

  const repoName = extractRepositoryNameFromStreamPath(session.streamPath);
  const payload: RecordingFinalizeJobData = {
    recordingSessionId: session.id,
    videoId: randomUUID(),
    repositoryId: session.repositoryId,
    ownerId: session.ownerId,
    repoName,
    targetDirectory: session.targetDirectory,
  };

  await processingService.enqueueRecordingFinalize(payload);
  console.info("[rtmp-finalize] enqueued", {
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    repositoryName: repoName,
    videoId: payload.videoId,
    segmentStatus: segment.status,
  });
  return true;
};
