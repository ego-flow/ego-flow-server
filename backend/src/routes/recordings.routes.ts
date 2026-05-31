import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { BadRequest } from "../lib/errors";
import { getAuthUser } from "../lib/request-context";
import { requireAppJwt, requireDashboardOrApp } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  recordingCloseIntentSchema,
  recordingSessionIdParamsSchema,
} from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";
import { repositoryService } from "../services/repository.service";

const router = Router();

/**
 * [녹화 종료 의도 기록]
 * 앱이 RTMP 연결을 정상 종료하기 직전에 호출한다.
 * 실제 CLOSED 전이는 MediaMTX stream-not-ready hook이 담당한다.
 */
// POST /api/v1/recordings/:recordingSessionId/close-intent
router.post(
  "/:recordingSessionId/close-intent",
  requireAppJwt,
  validate(recordingSessionIdParamsSchema, "params"),
  validate(recordingCloseIntentSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const { reason } = req.body as { reason: string };

    const session = await recordingSessionService.recordCloseIntent(
      recordingSessionId,
      user.userId,
      reason,
    );

    res.status(200).json({
      recording_session_id: session.id,
      end_reason: session.endReason,
    });
  }),
);

/**
 * [녹화 세션 상태 조회]
 * 특정 RecordingSession의 현재 상태, segment 수, video ID 등을 반환한다.
 * repository read 권한이 필요하다.
 */
// GET /api/v1/recordings/:recordingSessionId
router.get(
  "/:recordingSessionId",
  requireDashboardOrApp,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);

    const paramsParsed = recordingSessionIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      throw BadRequest("Invalid recording session identifier.");
    }

    const repositoryId = await recordingSessionService.getSessionRepositoryId(paramsParsed.data.recordingSessionId);
    await repositoryService.assertRepositoryAccess(user.userId, user.role, repositoryId, "read");

    const result = await recordingSessionService.getSessionStatus(paramsParsed.data.recordingSessionId);
    res.status(200).json(result);
  }),
);

export const recordingsRoutes = router;
