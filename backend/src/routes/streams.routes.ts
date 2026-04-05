import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAuth } from "../middleware/auth.middleware";
import { repoAccess } from "../middleware/repo-access.middleware";
import { validate } from "../middleware/validate.middleware";
import { streamRegisterSchema } from "../schemas/stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

/**
 * [스트리밍 등록] 앱이 RTMP 스트리밍을 시작하기 전에 서버에 세션을 등록하는 엔드포인트.
 * repository maintain 권한을 확인한 뒤, RecordingSession을 PENDING 상태로 생성하고
 * RTMP publish URL(인증 정보 포함)을 반환한다.
 * 앱은 이 URL로 MediaMTX에 직접 RTMP publish를 시작한다.
 */
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

/**
 * [활성 스트림 조회] 현재 STREAMING 상태인 세션 목록을 반환하는 엔드포인트.
 * 요청자의 repository read 권한으로 필터링하고,
 * MediaMTX에서 실제로 active인 path와 교집합하여 최종 목록에 HLS URL을 포함시킨다.
 * 프론트엔드 대시보드의 Live 페이지에서 5초 간격으로 polling한다.
 */
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

export const streamsRoutes = router;
