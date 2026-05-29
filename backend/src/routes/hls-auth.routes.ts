import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { NotFound, Unauthorized } from "../lib/errors";
import { getAuthUser } from "../lib/request-context";
import { requireDashboardOrAppOrPython } from "../middleware/auth.middleware";
import { hlsAuthService } from "../services/hls-auth.service";

const router = Router();

/**
 * [HLS playback gate]
 * Caddy `forward_auth`가 호출하는 subrequest endpoint.
 * - requireDashboardOrAppOrPython으로 cookie / app JWT / python static token 중 하나를 검증.
 * - 통과 시 path가 가리키는 stream에 대한 read 권한이 있으면 200.
 * - 권한 부족이나 stream 없음은 모두 404 (존재 숨김).
 */
// GET /api/v1/hls-auth
router.get(
  "/",
  requireDashboardOrAppOrPython,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    if (!req.auth?.rawCredential) {
      throw Unauthorized();
    }

    const path = typeof req.query.path === "string" ? req.query.path : "";
    if (!path) {
      throw NotFound("Stream not found.");
    }

    const outcome = await hlsAuthService.authorize({
      rawCredential: req.auth.rawCredential,
      path,
      userId: user.userId,
      userRole: user.role,
    });

    if (!outcome.ok) {
      throw NotFound("Stream not found.");
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).end();
  }),
);

export const hlsAuthRoutes = router;
