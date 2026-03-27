import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { repoAccess } from "../middleware/repo-access.middleware";
import { validate } from "../middleware/validate.middleware";
import { streamRegisterSchema, streamStopParamsSchema } from "../schemas/stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

router.post(
  "/register",
  requireAuth,
  validate(streamRegisterSchema),
  repoAccess({ minRole: "maintain", repoIdFrom: "body.repository_id" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const rawToken = req.headers.authorization?.split(" ")[1];
    if (!rawToken) {
      throw new AppError(401, "UNAUTHORIZED", "Bearer token is required.");
    }

    const response = await streamService.registerSession(req.user.userId, req.user.role, req.body, rawToken);
    res.status(200).json(response);
  }),
);

router.get(
  "/active",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const streams = await streamService.listActiveSessions(req.user.userId, req.user.role);
    res.status(200).json({ streams });
  }),
);

router.delete(
  "/:repositoryId",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const parsed = streamStopParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream session identifier.");
    }

    const response = await streamService.stopSession(req.user.userId, req.user.role, parsed.data.repositoryId);
    res.status(200).json(response);
  }),
);

export const streamsRoutes = router;
