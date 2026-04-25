import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { hlsAuthService } from "../services/hls-auth.service";

const router = Router();

/**
 * [HLS playback gate]
 * Caddy `forward_auth`가 호출하는 subrequest endpoint.
 * - requireAuth로 cookie / app JWT / python static token 중 하나를 검증.
 * - 통과 시 path가 가리키는 stream에 대한 read 권한이 있으면 200.
 * - 권한 부족이나 stream 없음은 모두 404 (존재 숨김).
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user || !req.auth?.rawCredential) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const path = typeof req.query.path === "string" ? req.query.path : "";
    if (!path) {
      throw new AppError(404, "NOT_FOUND", "Stream not found.");
    }

    const outcome = await hlsAuthService.authorize({
      rawCredential: req.auth.rawCredential,
      path,
      userId: req.user.userId,
      userRole: req.user.role,
    });

    if (!outcome.ok) {
      throw new AppError(404, "NOT_FOUND", "Stream not found.");
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).end();
  }),
);

export const hlsAuthRoutes = router;
