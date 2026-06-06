import express, { Router } from "express";

import { HTTP_STREAM_CHUNK_MAX_BYTES } from "../constants/stream/stream-constants";
import { asyncHandler } from "../lib/http/async-handler";
import { getAuthUser, getHttpStreamChunk } from "../lib/http/request-context";
import { requireAppJwt } from "../middleware/auth.middleware";
import { parseHttpStreamChunk } from "../middleware/http-stream.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  httpStreamFinishSchema,
  httpStreamStartSchema,
  recordingSessionIdParamsSchema,
} from "../schemas/stream.schema";
import { httpStreamService } from "../services/http-stream.service";

const router = Router();

// POST /api/v1/http-streams/:recordingSessionId/start
router.post(
  "/:recordingSessionId/start",
  requireAppJwt,
  validate(recordingSessionIdParamsSchema, "params"),
  validate(httpStreamStartSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const response = await httpStreamService.start(recordingSessionId, user.userId, req.body);
    res.status(200).json(response);
  }),
);

// POST /api/v1/http-streams/:recordingSessionId/chunks
router.post(
  "/:recordingSessionId/chunks",
  requireAppJwt,
  validate(recordingSessionIdParamsSchema, "params"),
  express.raw({
    type: "application/octet-stream",
    limit: HTTP_STREAM_CHUNK_MAX_BYTES,
  }),
  parseHttpStreamChunk,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const response = await httpStreamService.appendChunk(recordingSessionId, user.userId, getHttpStreamChunk(req));
    res.status(200).json(response);
  }),
);

// POST /api/v1/http-streams/:recordingSessionId/finish
router.post(
  "/:recordingSessionId/finish",
  requireAppJwt,
  validate(recordingSessionIdParamsSchema, "params"),
  validate(httpStreamFinishSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { recordingSessionId } = req.params as { recordingSessionId: string };
    const response = await httpStreamService.finish(recordingSessionId, user.userId, req.body);
    res.status(200).json(response);
  }),
);

export const httpStreamsRoutes = router;
