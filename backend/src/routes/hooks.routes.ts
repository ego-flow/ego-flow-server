import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { BadRequest } from "../lib/errors";
import {
  streamReadyHookSchema,
  streamNotReadyHookSchema,
  segmentCreateHookSchema,
  segmentCompleteHookSchema,
} from "../schemas/stream.schema";
import { recordingSessionService } from "../services/recording-session.service";

const router = Router();

/**
 * [MediaMTX hook: stream-ready]
 * MediaMTX runOnReady hook이 실제 RTMP 송출이 시작되었을 때 호출.
 * RecordingSession을 PENDING → STREAMING으로 전환하고,
 * readyAt을 기록한 뒤 Redis live cache와 active set을 갱신한다.
 */
// POST /api/v1/hooks/stream-ready
router.post(
  "/stream-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid stream-ready payload.");
    }

    await recordingSessionService.handleStreamReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: stream-not-ready]
 * MediaMTX runOnNotReady hook이 RTMP 연결이 끊어졌을 때 호출.
 * stream path의 recordingSessionId로 세션을 복원하고 CLOSED 상태로 닫는다.
 */
// POST /api/v1/hooks/stream-not-ready
router.post(
  "/stream-not-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamNotReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid stream-not-ready payload.");
    }

    await recordingSessionService.handleStreamNotReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: segment-create]
 * MediaMTX가 새 녹화 세그먼트 파일을 생성하기 시작할 때 호출.
 * stream path의 recordingSessionId로 세션을 찾고 segment path -> recordingSessionId mapping을 저장한 뒤
 * RecordingSegment를 WRITING 상태로 upsert한다.
 */
// POST /api/v1/hooks/recording-segment-create
router.post(
  "/recording-segment-create",
  asyncHandler(async (req, res) => {
    const parsed = segmentCreateHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid segment-create payload.");
    }

    await recordingSessionService.handleSegmentCreate(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: segment-complete]
 * MediaMTX가 녹화 세그먼트 파일 쓰기를 완료했을 때 호출.
 * stream path의 recordingSessionId를 기준으로 RecordingSegment를 WRITE_DONE 상태로 전환한다.
 * RecordingSession 상태는 변경하지 않고, 이미 CLOSED인 session에 대해서만 Video 후처리 job enqueue를 시도한다.
 */
// POST /api/v1/hooks/recording-segment-complete
router.post(
  "/recording-segment-complete",
  asyncHandler(async (req, res) => {
    const parsed = segmentCompleteHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw BadRequest("Invalid segment-complete payload.");
    }

    await recordingSessionService.handleSegmentComplete(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

export const hooksRoutes = router;
