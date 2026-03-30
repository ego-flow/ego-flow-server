import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { recordingSessionIdParamsSchema, recordingStopBodySchema } from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";
import { repositoryService } from "../services/repository.service";

const router = Router();

router.post(
  "/:recordingSessionId/stop",
  requireAuth,
  validate(recordingStopBodySchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const paramsParsed = recordingSessionIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid recording session identifier.");
    }

    const { recordingSessionId } = paramsParsed.data;
    const { reason } = req.body;
    const repositoryId = await recordingSessionService.getSessionRepositoryId(recordingSessionId);
    await repositoryService.assertRepositoryAccess(req.user.userId, req.user.role, repositoryId, "maintain");

    const session = await recordingSessionService.requestStop(recordingSessionId, reason);
    res.status(200).json({
      recording_session_id: session.id,
      status: "stop_requested",
    });
  }),
);

router.get(
  "/:recordingSessionId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const paramsParsed = recordingSessionIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid recording session identifier.");
    }

    const repositoryId = await recordingSessionService.getSessionRepositoryId(paramsParsed.data.recordingSessionId);
    await repositoryService.assertRepositoryAccess(req.user.userId, req.user.role, repositoryId, "read");

    const result = await recordingSessionService.getSessionStatus(paramsParsed.data.recordingSessionId);
    res.status(200).json(result);
  }),
);

export const recordingsRoutes = router;
