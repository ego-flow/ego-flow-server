import {
  type RecordingSession,
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
} from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

export type RecordingSessionRecord = Pick<
  RecordingSession,
  | "id"
  | "repositoryId"
  | "ownerId"
  | "userId"
  | "deviceType"
  | "ingestType"
  | "streamPath"
  | "targetDirectory"
  | "status"
  | "readyAt"
  | "createdAt"
  | "closedAt"
  | "endReason"
>;

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
        targetDirectory: true,
        status: true,
        readyAt: true,
        createdAt: true,
        closedAt: true,
        endReason: true,
      },
    });
  }

  async findReusablePendingSession(input: {
    repositoryId: string;
    userId: string;
    deviceType: string | null;
    ingestType: RecordingSessionIngestType;
  }): Promise<RecordingSession | null> {
    const pendingSessions = await prisma.recordingSession.findMany({
      where: {
        repositoryId: input.repositoryId,
        userId: input.userId,
        deviceType: input.deviceType,
        ingestType: input.ingestType,
        status: RecordingSessionStatus.PENDING,
      },
      orderBy: { createdAt: "desc" },
    });

    return pendingSessions[0] ?? null;
  }

  async refreshPendingSession(recordingSessionId: string): Promise<RecordingSession> {
    return prisma.recordingSession.update({
      where: { id: recordingSessionId },
      data: {
        status: RecordingSessionStatus.PENDING,
        updatedAt: new Date(),
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

  async markHttpUploadStreaming(input: {
    recordingSessionId: string;
    readyAt: Date;
  }): Promise<boolean> {
    const sessionUpdate = await prisma.recordingSession.updateMany({
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

    return sessionUpdate.count === 1;
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
        targetDirectory: true,
        status: true,
        readyAt: true,
        createdAt: true,
        closedAt: true,
        endReason: true,
      },
    });
  }

  async findStreamingByIngestType(ingestType: RecordingSessionIngestType): Promise<RecordingSessionRecord[]> {
    return prisma.recordingSession.findMany({
      where: {
        status: RecordingSessionStatus.STREAMING,
        ingestType,
      },
      select: {
        id: true,
        repositoryId: true,
        ownerId: true,
        userId: true,
        deviceType: true,
        ingestType: true,
        streamPath: true,
        targetDirectory: true,
        status: true,
        readyAt: true,
        createdAt: true,
        closedAt: true,
        endReason: true,
      },
    });
  }

  async countStreamingByRepositoryId(repositoryId: string): Promise<number> {
    return prisma.recordingSession.count({
      where: {
        repositoryId,
        status: RecordingSessionStatus.STREAMING,
      },
    });
  }

  async countByParticipantUserId(userId: string): Promise<number> {
    return prisma.recordingSession.count({
      where: {
        OR: [{ userId }, { ownerId: userId }],
      },
    });
  }

  async hasOpenSessionByRepositoryId(input: {
    repositoryId: string;
    blockPending: boolean;
  }): Promise<boolean> {
    const sessionStatusFilter = input.blockPending
      ? {
          in: [
            RecordingSessionStatus.PENDING,
            RecordingSessionStatus.STREAMING,
          ],
        }
      : RecordingSessionStatus.STREAMING;

    const activeSession = await prisma.recordingSession.findFirst({
      where: {
        repositoryId: input.repositoryId,
        status: sessionStatusFilter,
      },
      select: { id: true },
    });

    return Boolean(activeSession);
  }

  async deleteManyByRepositoryId(
    repositoryId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.recordingSession.deleteMany({ where: { repositoryId } });
  }

  async closeStreamingHttpUpload(input: {
    recordingSessionId: string;
    userId?: string;
    closedAt: Date;
    endReason: RecordingSessionEndReason;
  }): Promise<boolean> {
    const sessionUpdate = await prisma.recordingSession.updateMany({
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

    return sessionUpdate.count === 1;
  }
}

export const recordingSessionRepository = new RecordingSessionRepository();
