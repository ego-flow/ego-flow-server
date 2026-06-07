import { RecordingSegmentStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

export const recordingSegmentRepository = {
  findByRecordingSessionId(recordingSessionId: string) {
    return prisma.recordingSegments.findUnique({
      where: { recordingSessionId },
    });
  },

  findFinalizeStateByRecordingSessionId(recordingSessionId: string) {
    return prisma.recordingSegments.findUnique({
      where: { recordingSessionId },
      select: {
        status: true,
        rawPath: true,
      },
    });
  },

  upsertWriting(input: { recordingSessionId: string; rawPath: string }) {
    return prisma.recordingSegments.upsert({
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
    return prisma.recordingSegments.create({
      data: {
        recordingSessionId: input.recordingSessionId,
        rawPath: input.rawPath,
        status: RecordingSegmentStatus.WRITING,
      },
    });
  },

  markWriteDone(id: string, completedAt: Date) {
    return prisma.recordingSegments.update({
      where: { id },
      data: {
        status: RecordingSegmentStatus.WRITE_DONE,
        completedAt,
      },
    });
  },

  async claimProcessing(id: string): Promise<boolean> {
    const claim = await prisma.recordingSegments.updateMany({
      where: {
        id,
        status: RecordingSegmentStatus.WRITE_DONE,
      },
      data: { status: RecordingSegmentStatus.PROCESSING },
    });

    return claim.count === 1;
  },

  async resetProcessingToWriteDone(id: string): Promise<boolean> {
    const reset = await prisma.recordingSegments.updateMany({
      where: {
        id,
        status: RecordingSegmentStatus.PROCESSING,
      },
      data: { status: RecordingSegmentStatus.WRITE_DONE },
    });

    return reset.count === 1;
  },

  async markCompletedIfProcessing(
    id: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<boolean> {
    const segmentUpdate = await client.recordingSegments.updateMany({
      where: {
        id,
        status: RecordingSegmentStatus.PROCESSING,
      },
      data: { status: RecordingSegmentStatus.COMPLETED },
    });

    return segmentUpdate.count === 1;
  },

  async markWriteDoneByRecordingSessionId(recordingSessionId: string, completedAt: Date): Promise<boolean> {
    const segmentUpdate = await prisma.recordingSegments.updateMany({
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
    const segmentUpdate = await prisma.recordingSegments.updateMany({
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

  async markFailedForFinalize(
    recordingSessionId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<boolean> {
    const segmentUpdate = await client.recordingSegments.updateMany({
      where: { recordingSessionId },
      data: { status: RecordingSegmentStatus.FAILED },
    });

    return segmentUpdate.count === 1;
  },

  async findRawPathByRecordingSessionId(recordingSessionId: string): Promise<{ rawPath: string } | null> {
    return prisma.recordingSegments.findUnique({
      where: { recordingSessionId },
      select: {
        rawPath: true,
      },
    });
  },

  countFinalizingByRepositoryId(repositoryId: string) {
    return prisma.recordingSegments.count({
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
    const finalizingSegment = await prisma.recordingSegments.findFirst({
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
    await client.recordingSegments.deleteMany({
      where: { recordingSession: { repositoryId } },
    });
  },
};
