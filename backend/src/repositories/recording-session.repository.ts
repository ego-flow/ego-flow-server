import { randomUUID } from "node:crypto";

import {
  type Prisma,
  type RecordingSession,
  RecordingSegmentStatus,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
  VideoStatus,
} from "@prisma/client";

import { prisma } from "../lib/prisma";

export type RecordingSessionRecord = Pick<
  RecordingSession,
  | "id"
  | "repositoryId"
  | "ownerId"
  | "userId"
  | "deviceType"
  | "ingestType"
  | "streamPath"
  | "status"
  | "readyAt"
  | "createdAt"
  | "closedAt"
  | "endReason"
>;

class RecordingSessionTransitionRace extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingSessionTransitionRace";
  }
}

export class RecordingSessionRepository {
  async create(input: {
    id?: string;
    repositoryId: string;
    ownerId: string;
    userId: string;
    deviceType?: string | null;
    ingestType: RecordingSessionIngestType;
    streamPath: string;
    targetDirectory: string;
  }) {
    return prisma.recordingSession.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        repositoryId: input.repositoryId,
        ownerId: input.ownerId,
        userId: input.userId,
        deviceType: input.deviceType ?? null,
        ingestType: input.ingestType,
        streamPath: input.streamPath,
        status: RecordingSessionStatus.PENDING,
        targetDirectory: input.targetDirectory,
      },
    });
  }

  async findById(recordingSessionId: string): Promise<RecordingSessionRecord | null> {
    return prisma.recordingSession.findUnique({
      where: { id: recordingSessionId },
      select: {
        id: true,
        repositoryId: true,
        ownerId: true,
        userId: true,
        deviceType: true,
        ingestType: true,
        streamPath: true,
        status: true,
        readyAt: true,
        createdAt: true,
        closedAt: true,
        endReason: true,
      },
    });
  }

  async markStreaming(recordingSessionId: string, readyAt: Date | null) {
    return prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.STREAMING,
        ...(readyAt ? { readyAt } : {}),
      },
    });
  }

  async close(input: {
    recordingSessionId: string;
    closedAt: Date;
    endReason: RecordingSessionEndReason;
  }) {
    return prisma.recordingSession.update({
      where: { id: input.recordingSessionId },
      data: {
        status: RecordingSessionStatus.CLOSED,
        closedAt: input.closedAt,
        endReason: input.endReason,
      },
    });
  }

  async recordCloseIntent(recordingSessionId: string, endReason: RecordingSessionEndReason) {
    return prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        endReason,
      },
    });
  }

  async startHttpUpload(input: {
    recordingSessionId: string;
    rawPath: string;
    readyAt: Date;
  }): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const sessionUpdate = await tx.recordingSession.updateMany({
        where: {
          id: input.recordingSessionId,
          status: RecordingSessionStatus.PENDING,
          ingestType: RecordingSessionIngestType.HTTP,
        },
        data: {
          status: RecordingSessionStatus.STREAMING,
          readyAt: input.readyAt,
        },
      });
      if (sessionUpdate.count !== 1) {
        return false;
      }

      await tx.recordingSegment.create({
        data: {
          recordingSessionId: input.recordingSessionId,
          rawPath: input.rawPath,
          status: RecordingSegmentStatus.WRITING,
        },
      });

      return true;
    });
  }

  async findStreamingHttpUploads(): Promise<RecordingSessionRecord[]> {
    return prisma.recordingSession.findMany({
      where: {
        status: RecordingSessionStatus.STREAMING,
        ingestType: RecordingSessionIngestType.HTTP,
      },
      select: {
        id: true,
        repositoryId: true,
        ownerId: true,
        userId: true,
        deviceType: true,
        ingestType: true,
        streamPath: true,
        status: true,
        readyAt: true,
        createdAt: true,
        closedAt: true,
        endReason: true,
      },
    });
  }

  async closeHttpUploadAsWriteDone(input: {
    recordingSessionId: string;
    userId?: string;
    closedAt: Date;
    endReason: RecordingSessionEndReason;
  }): Promise<boolean> {
    return this.runClaimedTransition(async (tx) => {
      const sessionUpdate = await tx.recordingSession.updateMany({
        where: {
          id: input.recordingSessionId,
          ...(input.userId ? { userId: input.userId } : {}),
          status: RecordingSessionStatus.STREAMING,
          ingestType: RecordingSessionIngestType.HTTP,
        },
        data: {
          status: RecordingSessionStatus.CLOSED,
          closedAt: input.closedAt,
          endReason: input.endReason,
        },
      });
      if (sessionUpdate.count !== 1) {
        throw new RecordingSessionTransitionRace("HTTP upload session was already closed.");
      }

      const segmentUpdate = await tx.recordingSegment.updateMany({
        where: {
          recordingSessionId: input.recordingSessionId,
          status: RecordingSegmentStatus.WRITING,
        },
        data: {
          status: RecordingSegmentStatus.WRITE_DONE,
          completedAt: input.closedAt,
        },
      });
      if (segmentUpdate.count !== 1) {
        throw new RecordingSessionTransitionRace("HTTP upload segment was already finalized.");
      }
    });
  }

  async findSegmentRawPath(recordingSessionId: string): Promise<{ rawPath: string } | null> {
    return prisma.recordingSegment.findUnique({
      where: { recordingSessionId },
      select: {
        rawPath: true,
      },
    });
  }

  async failHttpUpload(input: {
    session: RecordingSessionRecord;
    rawPath: string;
    errorMessage: string;
    closedAt: Date;
  }): Promise<boolean> {
    return this.runClaimedTransition(async (tx) => {
      const sessionUpdate = await tx.recordingSession.updateMany({
        where: {
          id: input.session.id,
          status: RecordingSessionStatus.STREAMING,
          ingestType: RecordingSessionIngestType.HTTP,
        },
        data: {
          status: RecordingSessionStatus.CLOSED,
          closedAt: input.closedAt,
          endReason: RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
        },
      });
      if (sessionUpdate.count !== 1) {
        throw new RecordingSessionTransitionRace("HTTP upload session was already closed.");
      }

      const segmentUpdate = await tx.recordingSegment.updateMany({
        where: {
          recordingSessionId: input.session.id,
          status: RecordingSegmentStatus.WRITING,
        },
        data: {
          status: RecordingSegmentStatus.FAILED,
          completedAt: input.closedAt,
        },
      });
      if (segmentUpdate.count !== 1) {
        throw new RecordingSessionTransitionRace("HTTP upload segment was already finalized.");
      }

      await tx.video.upsert({
        where: { recordingSessionId: input.session.id },
        create: {
          id: randomUUID(),
          repositoryId: input.session.repositoryId,
          recordingSessionId: input.session.id,
          rawRecordingPath: input.rawPath,
          streamPath: input.session.streamPath,
          deviceType: input.session.deviceType,
          recorder: input.session.userId,
          status: VideoStatus.FAILED,
          errorMessage: input.errorMessage,
          processingStartedAt: input.closedAt,
          processingCompletedAt: input.closedAt,
        },
        update: {
          repositoryId: input.session.repositoryId,
          rawRecordingPath: input.rawPath,
          streamPath: input.session.streamPath,
          deviceType: input.session.deviceType,
          recorder: input.session.userId,
          status: VideoStatus.FAILED,
          errorMessage: input.errorMessage,
          processingCompletedAt: input.closedAt,
        },
      });
    });
  }

  private async runClaimedTransition(callback: (tx: Prisma.TransactionClient) => Promise<void>) {
    try {
      await prisma.$transaction(callback);
      return true;
    } catch (error) {
      if (error instanceof RecordingSessionTransitionRace) {
        return false;
      }
      throw error;
    }
  }
}

export const recordingSessionRepository = new RecordingSessionRepository();
