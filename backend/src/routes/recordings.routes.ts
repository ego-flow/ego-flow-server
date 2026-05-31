import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { getAuthUser } from "../lib/request-context";
import { requireAppJwt } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  recordingCloseIntentSchema,
  recordingSessionIdParamsSchema,
} from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";

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

    await recordingSessionService.recordCloseIntent(
      recordingSessionId,
      user.userId,
      reason,
    );

    res.status(200).json({
      ok: true,
    });
  }),
);

export const recordingsRoutes = router;
