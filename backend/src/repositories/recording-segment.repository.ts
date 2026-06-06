import { RecordingSegmentStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

export const recordingSegmentRepository = {
  findByRecordingSessionId(recordingSessionId: string) {
    return prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
    });
  },

  findFinalizeStateByRecordingSessionId(recordingSessionId: string) {
    return prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
      select: {
        status: true,
        rawPath: true,
      },
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

  createWriting(input: { recordingSessionId: string; rawPath: string }) {
    return prisma.recordingSegment.create({
      data: {
        recordingSessionId: input.recordingSessionId,
        rawPath: input.rawPath,
        status: RecordingSegmentStatus.WRITING,
      },
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

  async markWriteDoneByRecordingSessionId(recordingSessionId: string, completedAt: Date): Promise<boolean> {
    const segmentUpdate = await prisma.recordingSegment.updateMany({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.WRITING,
      },
      data: {
        status: RecordingSegmentStatus.WRITE_DONE,
        completedAt,
      },
    });

    return segmentUpdate.count === 1;
  },

  async markFailedByRecordingSessionId(recordingSessionId: string, completedAt: Date): Promise<boolean> {
    const segmentUpdate = await prisma.recordingSegment.updateMany({
      where: {
        recordingSessionId,
        status: RecordingSegmentStatus.WRITING,
      },
      data: {
        status: RecordingSegmentStatus.FAILED,
        completedAt,
      },
    });

    return segmentUpdate.count === 1;
  },

  async findRawPathByRecordingSessionId(recordingSessionId: string): Promise<{ rawPath: string } | null> {
    return prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
      select: {
        rawPath: true,
      },
    });
  },

  countFinalizingByRepositoryId(repositoryId: string) {
    return prisma.recordingSegment.count({
      where: {
        status: {
          in: [
            RecordingSegmentStatus.WRITE_DONE,
            RecordingSegmentStatus.PROCESSING,
          ],
        },
        recordingSession: {
          repositoryId,
        },
      },
    });
  },

  async hasFinalizingByRepositoryId(repositoryId: string): Promise<boolean> {
    const finalizingSegment = await prisma.recordingSegment.findFirst({
      where: {
        status: {
          in: [
            RecordingSegmentStatus.WRITE_DONE,
            RecordingSegmentStatus.PROCESSING,
          ],
        },
        recordingSession: {
          repositoryId,
        },
      },
      select: { id: true },
    });

    return Boolean(finalizingSegment);
  },

  async deleteManyByRepositoryId(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.recordingSegment.deleteMany({
      where: { recordingSession: { repositoryId } },
    });
  },
};
