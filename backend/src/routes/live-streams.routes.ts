import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireDashboardOrAppOrPython } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { liveStreamIdParamSchema } from "../schemas/live-stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

/**
 * [Live stream 목록]
 * 요청자가 접근 가능한 현재 활성 live stream의 metadata와 HLS path를 반환한다.
 * 클라이언트는 응답의 hls_path를 그대로 사용해 HLS를 요청하면 되고,
 * Caddy `forward_auth` -> `/api/v1/hls-auth`가 인증/권한 게이트를 담당한다.
 * dashboard Live 페이지와 Python package가 모두 사용하는 canonical list endpoint.
 */
router.get(
  "/",
  requireDashboardOrAppOrPython,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const streams = await streamService.listLiveStreams(req.user.userId, req.user.role);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ streams });
  }),
);

/**
 * [Live stream 상세]
 * 단일 stream의 상세 metadata + playback_ready(MediaMTX path 활성 여부)를 반환한다.
 */
router.get(
  "/:streamId",
  requireDashboardOrAppOrPython,
  validate(liveStreamIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const { streamId } = req.params as { streamId: string };
    const result = await streamService.getLiveStreamDetail(streamId, req.user.userId, req.user.role);
    res.status(200).json(result);
  }),
);

export const liveStreamsRoutes = router;
