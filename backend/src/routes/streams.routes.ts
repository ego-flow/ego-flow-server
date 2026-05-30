import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { getAuthUser } from "../lib/request-context";
import { requireAppJwt } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  publishTicketParamsSchema,
  streamRegisterSchema,
} from "../schemas/stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

/**
 * [스트리밍 등록] 앱이 RTMP 스트리밍을 시작하기 전에 서버에 세션을 등록하는 엔드포인트.
 * repository maintain 권한을 확인한 뒤, RecordingSession을 PENDING 상태로 생성하고
 * recordingSessionId를 반환한다.
 * 실제 RTMP publish credential은 후속 publish-ticket 발급으로 분리된다.
 */
// POST /api/v1/streams/register
router.post(
  "/register",
  requireAppJwt,
  validate(streamRegisterSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await streamService.registerSession(user.userId, user.role, req.body);
    res.status(200).json(response);
  }),
);

// POST /api/v1/streams/:recordingSessionId/publish-ticket
router.post(
  "/:recordingSessionId/publish-ticket",
  requireAppJwt,
  validate(publishTicketParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const response = await streamService.issuePublishTicket(
      user.userId,
      user.role,
      recordingSessionId,
    );
    res.status(200).json(response);
  }),
);

export const streamsRoutes = router;
