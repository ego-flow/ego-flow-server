import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireAppJwt } from "../middleware/auth.middleware";
import { repoAccess } from "../middleware/repo-access.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  publishTicketParamsSchema,
  streamConnectionHeartbeatBodySchema,
  streamConnectionHeartbeatParamsSchema,
  streamRegisterSchema,
} from "../schemas/stream.schema";
import { streamService } from "../services/stream.service";

const router = Router();

/**
 * [스트리밍 등록] 앱이 RTMP 스트리밍을 시작하기 전에 서버에 세션을 등록하는 엔드포인트.
 * repository maintain 권한을 확인한 뒤, RecordingSession을 PENDING 상태로 생성하고
 * recording session metadata를 반환한다.
 * 실제 RTMP publish credential은 후속 publish-ticket 발급으로 분리된다.
 */
router.post(
  "/register",
  requireAppJwt,
  validate(streamRegisterSchema),
  repoAccess({ minRole: "maintain", repoIdFrom: "body.repository_id" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await streamService.registerSession(req.user.userId, req.user.role, req.body);
    res.status(200).json(response);
  }),
);

router.post(
  "/:recordingSessionId/publish-ticket",
  requireAppJwt,
  validate(publishTicketParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const response = await streamService.issuePublishTicket(
      req.user.userId,
      req.user.role,
      recordingSessionId,
    );
    res.status(200).json(response);
  }),
);

router.post(
  "/:recordingSessionId/connections/:connectionId/heartbeat",
  requireAppJwt,
  validate(streamConnectionHeartbeatParamsSchema, "params"),
  validate(streamConnectionHeartbeatBodySchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const { recordingSessionId, connectionId } = req.params as {
      recordingSessionId: string;
      connectionId: string;
    };
    const response = await streamService.refreshPublishConnectionLease(
      req.user.userId,
      req.user.role,
      recordingSessionId,
      connectionId,
      req.body.generation,
    );
    res.status(200).json(response);
  }),
);

export const streamsRoutes = router;
