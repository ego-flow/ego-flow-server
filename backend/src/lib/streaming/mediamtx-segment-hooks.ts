import { RecordingSegmentStatus } from "@prisma/client";

import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import type {
  SegmentCompleteHookInput,
  SegmentCreateHookInput,
} from "../../types/stream/request";
import { recordingSessionService } from "./recording-session";
import { extractRecordingSessionIdFromStreamPath } from "./stream-paths";

export const handleMediamtxSegmentCreate = async (
  input: SegmentCreateHookInput,
): Promise<void> => {
  const session = await resolveSegmentSession(input.path);
  if (!session) {
    console.warn("[rtmp-segment] session-missing", {
      path: input.path,
      segmentPath: input.segment_path,
    });
    return;
  }

  const recordingSessionId = session.id;
  const segment = await recordingSegmentRepository.upsertWriting({
    recordingSessionId,
    rawPath: input.segment_path,
  });

  if (segment.rawPath !== input.segment_path) {
    console.warn("[rtmp-segment] additional-segment-ignored", {
      recordingSessionId,
      path: input.path,
      existingSegmentPath: segment.rawPath,
      ignoredSegmentPath: input.segment_path,
    });
    return;
  }

  console.info("[rtmp-segment] writing-created", {
    recordingSessionId,
    path: input.path,
    segmentPath: input.segment_path,
  });
};

export const handleMediamtxSegmentComplete = async (
  input: SegmentCompleteHookInput,
): Promise<void> => {
  const recordingSessionId = extractRecordingSessionIdFromStreamPath(input.path);
  if (!recordingSessionId) {
    console.warn("[rtmp-segment] complete-path-invalid", {
      path: input.path,
      segmentPath: input.segment_path,
    });
    return;
  }

  const segment = await recordingSegmentRepository.findByRecordingSessionId(recordingSessionId);
  if (!segment) {
    console.warn("[rtmp-segment] complete-segment-missing", {
      recordingSessionId,
      path: input.path,
      segmentPath: input.segment_path,
    });
    return;
  }

  if (segment.rawPath !== input.segment_path) {
    console.warn("[rtmp-segment] complete-path-mismatch", {
      recordingSessionId,
      path: input.path,
      existingSegmentPath: segment.rawPath,
      ignoredSegmentPath: input.segment_path,
    });
    return;
  }

  if (segment.status !== RecordingSegmentStatus.WRITING) {
    console.info("[rtmp-segment] complete-ignored", {
      recordingSessionId,
      path: input.path,
      segmentPath: input.segment_path,
      segmentStatus: segment.status,
    });
    return;
  }

  await recordingSegmentRepository.markWriteDone(segment.id, new Date());

  console.info("[rtmp-segment] write-done", {
    recordingSessionId: segment.recordingSessionId,
    path: input.path,
    segmentPath: input.segment_path,
  });

  await recordingSessionService.tryEnqueueFinalize(segment.recordingSessionId);
};

const resolveSegmentSession = async (streamPath: string) => {
  const recordingSessionId = extractRecordingSessionIdFromStreamPath(streamPath);
  if (!recordingSessionId) {
    return null;
  }
  return recordingSessionRepository.findById(recordingSessionId);
};
