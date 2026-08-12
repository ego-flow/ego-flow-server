import { VideoSemanticMetadataStatus } from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "../lib/infra/prisma";

export class VideoSemanticMetadataRepository {
  async upsertPending(
    videoId: string,
    client: PrismaTransactionClient | typeof prisma = prisma,
  ): Promise<void> {
    await client.videoSemanticMetadata.upsert({
      where: { videoId },
      create: {
        videoId,
        status: VideoSemanticMetadataStatus.PENDING,
      },
      update: {},
    });
  }
}

export const videoSemanticMetadataRepository = new VideoSemanticMetadataRepository();
