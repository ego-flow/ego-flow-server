import { Router } from "express";

import { asyncHandler } from "../lib/http/async-handler";
import { NotFound } from "../lib/core/errors";
import { getRepositoryAccessContext } from "../lib/http/request-context";
import { requireDashboardOrPython, requireDashboardSession } from "../middleware/auth.middleware";
import { repoAccess, repoStatus } from "../middleware/repository.middleware";
import { validate } from "../middleware/validate.middleware";
import type {
  RepoVideoListQueryInput,
  RepoVideoParamsInput,
} from "../types/videos/request";
import {
  repoVideoListQuerySchema,
  repoVideoParamsSchema,
  repoVideoRepositoryParamSchema,
} from "../schemas/repository-video.schema";
import { videosService } from "../services/videos.service";

const router = Router({ mergeParams: true });

router.use(validate(repoVideoRepositoryParamSchema, "params"));

// GET /api/v1/repositories/:repoId/videos
router.get(
  "/",
  requireDashboardSession,
  repoAccess({ action: "video.list" }),
  repoStatus({ required: "active" }),
  validate(repoVideoListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const response = await videosService.listRepositoryVideos(
      getRepositoryAccessContext(req).repository,
      req.query as unknown as RepoVideoListQueryInput,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/videos/:videoId
router.get(
  "/:videoId",
  requireDashboardSession,
  repoAccess({ action: "video.detail" }),
  repoStatus({ required: "active" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videosService.getRepositoryVideoDetail(
      params.repoId,
      getRepositoryAccessContext(req).repository,
      params.videoId,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/videos/:videoId/status
router.get(
  "/:videoId/status",
  requireDashboardSession,
  repoAccess({ action: "video.status" }),
  repoStatus({ required: "active" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videosService.getRepositoryVideoStatus(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/repositories/:repoId/videos/:videoId
router.delete(
  "/:videoId",
  requireDashboardSession,
  repoAccess({ action: "video.delete" }),
  repoStatus({ required: "active" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videosService.deleteRepositoryVideo(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

// Block Express' implicit HEAD handling for this GET-only redirect endpoint.
router.head("/:videoId/download", (_req, _res, next) => {
  next(NotFound("Route not found."));
});

// GET /api/v1/repositories/:repoId/videos/:videoId/download
router.get(
  "/:videoId/download",
  requireDashboardOrPython,
  repoAccess({ action: "video.download" }),
  repoStatus({ required: "active" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const download = await videosService.getRepositoryVideoDownload(params.repoId, params.videoId);
    res.redirect(307, download.redirectUrl);
  }),
);

// Block Express' implicit HEAD handling for this GET-only redirect endpoint.
router.head("/:videoId/thumbnail", (_req, _res, next) => {
  next(NotFound("Route not found."));
});

// GET /api/v1/repositories/:repoId/videos/:videoId/thumbnail
router.get(
  "/:videoId/thumbnail",
  requireDashboardOrPython,
  repoAccess({ action: "video.download" }),
  repoStatus({ required: "active" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const thumbnail = await videosService.getRepositoryVideoThumbnail(params.repoId, params.videoId);
    res.redirect(307, thumbnail.redirectUrl);
  }),
);

export const videosRoutes = router;
