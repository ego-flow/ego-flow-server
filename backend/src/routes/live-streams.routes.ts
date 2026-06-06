import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { getAuthUser } from "../lib/request-context";
import { requireDashboardOrAppOrPython, requireDashboardOrPython } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  liveStreamRecordingSessionParamSchema,
  type LiveStreamRecordingSessionParamInput,
} from "../schemas/live-stream.schema";
import { liveStreamsService } from "../services/live-streams.service";

const router = Router();

/**
 * [Live stream 목록]
 * 요청자가 접근 가능한 현재 활성 live stream의 metadata와 native stream path를 반환한다.
 * 클라이언트는 선택한 recording_session_id로 playback ticket을 발급받은 뒤
 * stream_path 기반 MediaMTX HLS URL을 직접 조립한다.
 * dashboard Live 페이지와 Python package가 모두 사용하는 canonical list endpoint.
 */
// GET /api/v1/live-streams
router.get(
  "/",
  requireDashboardOrAppOrPython,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const streams = await liveStreamsService.listLiveStreams(user.userId, user.role);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ streams });
  }),
);

/**
 * [Live stream 상세]
 * 단일 stream의 상세 metadata + playback_ready(MediaMTX path 활성 여부)를 반환한다.
 */
// GET /api/v1/live-streams/:recordingSessionId
router.get(
  "/:recordingSessionId",
  requireDashboardOrAppOrPython,
  validate(liveStreamRecordingSessionParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as LiveStreamRecordingSessionParamInput;
    const result = await liveStreamsService.getLiveStreamDetail(recordingSessionId, user.userId, user.role);
    res.status(200).json(result);
  }),
);

// POST /api/v1/live-streams/:recordingSessionId/playback-ticket
router.post(
  "/:recordingSessionId/playback-ticket",
  requireDashboardOrPython,
  validate(liveStreamRecordingSessionParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as LiveStreamRecordingSessionParamInput;
    const result = await liveStreamsService.issueHlsPlaybackTicket(recordingSessionId, user.userId, user.role);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(result);
  }),
);

export const liveStreamsRoutes = router;
