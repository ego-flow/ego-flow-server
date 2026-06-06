import { RecordingSegmentStatus } from "@prisma/client";

import { prisma } from "../lib/prisma";

export const recordingSegmentRepository = {
  findByRecordingSessionId(recordingSessionId: string) {
    return prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
    });
  },

  upsertWriting(input: { recordingSessionId: string; rawPath: string }) {
    return prisma.recordingSegment.upsert({
      where: { recordingSessionId: input.recordingSessionId },
      create: {
        recordingSessionId: input.recordingSessionId,
        rawPath: input.rawPath,
        status: RecordingSegmentStatus.WRITING,
      },
      update: {},
    });
  },

  markWriteDone(id: string, completedAt: Date) {
    return prisma.recordingSegment.update({
      where: { id },
      data: {
        status: RecordingSegmentStatus.WRITE_DONE,
        completedAt,
      },
    });
  },
};
