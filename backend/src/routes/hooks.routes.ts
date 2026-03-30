import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import {
  streamReadyHookSchema,
  streamNotReadyHookSchema,
  segmentCreateHookSchema,
  segmentCompleteHookSchema,
} from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";

const router = Router();

router.post(
  "/stream-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream-ready payload.");
    }

    await recordingSessionService.handleStreamReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

router.post(
  "/stream-not-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamNotReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream-not-ready payload.");
    }

    await recordingSessionService.handleStreamNotReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

router.post(
  "/recording-segment-create",
  asyncHandler(async (req, res) => {
    const parsed = segmentCreateHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid segment-create payload.");
    }

    await recordingSessionService.handleSegmentCreate(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

router.post(
  "/recording-segment-complete",
  asyncHandler(async (req, res) => {
    const parsed = segmentCompleteHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid segment-complete payload.");
    }

    await recordingSessionService.handleSegmentComplete(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

export const hooksRoutes = router;
