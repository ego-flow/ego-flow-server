import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
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
 * sourceId/sourceType/readyAt을 기록하며 Redis live pointer를 갱신한다.
 */
router.post(
  "/stream-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream-ready payload.");
    }

    await recordingSessionService.handleStreamReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: stream-not-ready]
 * MediaMTX runOnNotReady hook이 RTMP 연결이 끊어졌을 때 호출.
 * authoritative `stream:source:{sourceId}` mapping으로 connection/generation을 복원하고,
 * generation match release가 성공한 경우에만 해당 세션을 FINALIZING으로 전환한다.
 */
router.post(
  "/stream-not-ready",
  asyncHandler(async (req, res) => {
    const parsed = streamNotReadyHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid stream-not-ready payload.");
    }

    await recordingSessionService.handleStreamNotReady(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: segment-create]
 * MediaMTX가 새 녹화 세그먼트 파일을 생성하기 시작할 때 호출.
 * authoritative `source_id`로 세션을 찾고 segment ownership mapping을 저장한 뒤
 * RecordingSegment를 WRITING 상태로 upsert한다.
 */
router.post(
  "/recording-segment-create",
  asyncHandler(async (req, res) => {
    const parsed = segmentCreateHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid segment-create payload.");
    }

    await recordingSessionService.handleSegmentCreate(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

/**
 * [MediaMTX hook: segment-complete]
 * MediaMTX가 녹화 세그먼트 파일 쓰기를 완료했을 때 호출.
 * stored segment ownership mapping만 사용해 RecordingSegment를 COMPLETED 상태로 전환하고, duration을 기록한다.
 * 세션이 이미 FINALIZING이면 finalize enqueue를 재시도한다.
 */
router.post(
  "/recording-segment-complete",
  asyncHandler(async (req, res) => {
    const parsed = segmentCompleteHookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid segment-complete payload.");
    }

    await recordingSessionService.handleSegmentComplete(parsed.data);
    res.status(200).json({ ok: true });
  }),
);

export const hooksRoutes = router;
