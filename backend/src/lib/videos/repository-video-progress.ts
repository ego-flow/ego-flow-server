import { VideoStatus } from "@prisma/client";

import { processingService } from "../processing/processing-queue";
import type { RecordingFinalizeProgress } from "../../types/processing";
import type { RepositoryVideoMapperInput } from "../../types/videos/model";

export const getRecordingFinalizeProgress = (
  recordingSessionId: string | null,
): Promise<RecordingFinalizeProgress | null> =>
  processingService.getRecordingFinalizeProgress(recordingSessionId);

export const getRepositoryVideoProcessingProgress = (
  video: Pick<RepositoryVideoMapperInput, "recordingSessionId" | "status">,
): Promise<RecordingFinalizeProgress | null> =>
  video.status === VideoStatus.PROCESSING
    ? getRecordingFinalizeProgress(video.recordingSessionId)
    : Promise.resolve(null);

export const getProcessingProgressByVideoId = async (
  videos: Array<Pick<RepositoryVideoMapperInput, "id" | "recordingSessionId" | "status">>,
): Promise<Map<string, RecordingFinalizeProgress | null>> => {
  const entries = await Promise.all(
    videos.map(async (video) => {
      const progress = await getRepositoryVideoProcessingProgress(video);

      return [video.id, progress] as const;
    }),
  );

  return new Map(entries);
};
