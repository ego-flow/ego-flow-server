import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAppJwt, requireDashboardOrApp } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { recordingSessionIdParamsSchema, recordingStopBodySchema } from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";
import { repositoryService } from "../services/repository.service";

const router = Router();

/**
 * [녹화 중지 요청]
 * 앱에서 Stop 버튼 또는 glasses 촬영 종료 시 호출.
 * repository maintain 권한을 확인한 뒤 세션을 STOP_REQUESTED 상태로 전환한다.
 * reason은 "USER_STOP" 또는 "GLASSES_STOP".
 * 이후 앱이 RTMP 연결을 끊으면 MediaMTX stream-not-ready hook이 FINALIZING을 트리거한다.
 */
router.post(
  "/:recordingSessionId/stop",
  requireAppJwt,
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

/**
 * [녹화 세션 상태 조회]
 * 특정 RecordingSession의 현재 상태, segment 수, video ID 등을 반환한다.
 * repository read 권한이 필요하다.
 */
router.get(
  "/:recordingSessionId",
  requireDashboardOrApp,
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
