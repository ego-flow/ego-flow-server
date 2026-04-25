import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { liveStreamIdParamSchema } from "../schemas/live-stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

/**
 * [Live stream 목록]
 * 요청자가 접근 가능한 현재 활성 live stream의 metadata를 반환한다.
 * playback 정보(HLS path, token)는 포함하지 않는다. 개별 /playback endpoint에서 선택 후 발급.
 * dashboard Live 페이지와 Python package가 모두 사용하는 canonical list endpoint.
 */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const streams = await streamService.listLiveStreams(req.user.userId, req.user.role);
    res.status(200).json({ streams });
  }),
);

/**
 * [Live stream 상세]
 * 단일 stream의 상세 metadata + playback_ready(MediaMTX path 활성 여부)를 반환한다.
 */
router.get(
  "/:streamId",
  requireAuth,
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

/**
 * [Live stream playback]
 * HLS path와 ephemeral bearer token을 발급한다.
 * Dashboard와 Python package 모두 이 응답의 auth.token을
 * "Authorization: Bearer <token>" header로 HLS 요청에 붙이면 MediaMTX가 검증한다.
 */
router.get(
  "/:streamId/playback",
  requireAuth,
  validate(liveStreamIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const { streamId } = req.params as { streamId: string };
    const result = await streamService.getLiveStreamPlayback(streamId, req.user.userId, req.user.role);
    res.status(200).json(result);
  }),
);

export const liveStreamsRoutes = router;
