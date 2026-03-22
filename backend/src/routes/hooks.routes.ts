import { Router } from "express";
import { VideoStatus } from "@prisma/client";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { recordingCompleteSchema } from "../schemas/stream.schema";
import { processingService } from "../services/processing.service";
import { streamService } from "../services/stream.service";

const router = Router();

router.all(
  "/recording-complete",
  asyncHandler(async (req, res) => {
    const parsed = recordingCompleteSchema.safeParse({
      path: typeof req.body?.path === "string" ? req.body.path : req.query.path,
      recording_path:
        typeof req.body?.recording_path === "string" ? req.body.recording_path : req.query.recording_path,
    });
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid recording completion payload.");
    }

    const payload = parsed.data;

    const existing = await prisma.video.findFirst({
      where: {
        rawRecordingPath: payload.recording_path,
      },
    });
    if (existing) {
      res.status(200).json({
        video_id: existing.id,
        status: existing.status,
      });
      return;
    }

    const { videoKey, session } = await streamService.consumeSessionForRecordingPath(payload.path);

    const video = await prisma.video.create({
      data: {
        videoKey,
        userId: session.userId,
        rawRecordingPath: payload.recording_path,
        streamPath: payload.path,
        deviceType: session.deviceType ?? null,
        sessionId: session.sessionId,
        status: VideoStatus.PENDING,
      },
    });

    try {
      await processingService.enqueueVideoProcessing({
        videoId: video.id,
        videoKey,
        userId: session.userId,
        rawRecordingPath: payload.recording_path,
        targetDirectory: session.targetDirectory,
      });
    } catch (error) {
      await prisma.video.delete({ where: { id: video.id } }).catch(() => {
        // Ignore cleanup failure and surface the original enqueue error.
      });
      throw error;
    }

    res.status(200).json({
      video_id: video.id,
      status: video.status,
    });
  }),
);

export const hooksRoutes = router;
