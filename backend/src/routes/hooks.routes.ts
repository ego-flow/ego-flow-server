import { Router } from "express";
import { VideoStatus } from "@prisma/client";

import { asyncHandler } from "../lib/async-handler";
import { prisma } from "../lib/prisma";
import { validate } from "../middleware/validate.middleware";
import { recordingCompleteSchema } from "../schemas/stream.schema";
import { processingService } from "../services/processing.service";
import { streamService } from "../services/stream.service";

const router = Router();

router.post(
  "/recording-complete",
  validate(recordingCompleteSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body;

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
