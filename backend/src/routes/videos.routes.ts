import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type { VideoListQueryInput } from "../schemas/video.schema";
import { videoListQuerySchema } from "../schemas/video.schema";
import { videoService } from "../services/video.service";

const router = Router();

router.get(
  "/",
  requireAuth,
  validate(videoListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await videoService.listVideos(
      req.user.userId,
      req.user.role,
      req.query as unknown as VideoListQueryInput,
    );
    res.status(200).json(response);
  }),
);

export const videosRoutes = router;
