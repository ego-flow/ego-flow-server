import fsp from "node:fs/promises";

import type { Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { NotFound } from "../lib/errors";
import { getRepositoryAccess } from "../lib/request-context";
import { toSignedFileUrl } from "../lib/signed-file-url";
import { getTargetDirectory } from "../lib/storage";
import { requireDashboardOrPython, requireDashboardSession } from "../middleware/auth.middleware";
import { repoAccess } from "../middleware/repo-access.middleware";
import { validate } from "../middleware/validate.middleware";
import type {
  RepoVideoListQueryInput,
  RepoVideoParamsInput,
} from "../schemas/repository-video.schema";
import {
  repoVideoListQuerySchema,
  repoVideoParamsSchema,
  repoVideoRepositoryParamSchema,
} from "../schemas/repository-video.schema";
import { videoService } from "../services/video.service";
import { isMissingFileError } from "../utils/file-system";

const router = Router({ mergeParams: true });

const ensureFileExists = async (filePath: string, missingMessage: string) => {
  try {
    await fsp.stat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw NotFound(missingMessage);
    }

    throw error;
  }
};

const redirectToSignedDownload = async (
  res: Response,
  video: {
    path: string;
  },
) => {
  await ensureFileExists(video.path, "Video file is not available.");

  const signedUrl = toSignedFileUrl(getTargetDirectory(), video.path);
  if (!signedUrl) {
    throw NotFound("Video file is not available.");
  }

  res.redirect(307, signedUrl);
};

router.use(validate(repoVideoRepositoryParamSchema, "params"));

// GET /api/v1/repositories/:repoId/videos
router.get(
  "/",
  requireDashboardSession,
  repoAccess({ minRole: "read" }),
  validate(repoVideoListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const response = await videoService.listRepositoryVideos(
      getRepositoryAccess(req).repository,
      req.query as unknown as RepoVideoListQueryInput,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/videos/:videoId
router.get(
  "/:videoId",
  requireDashboardSession,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.getRepositoryVideoDetail(
      params.repoId,
      getRepositoryAccess(req).repository,
      params.videoId,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/videos/:videoId/status
router.get(
  "/:videoId/status",
  requireDashboardSession,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.getRepositoryVideoStatus(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/repositories/:repoId/videos/:videoId
router.delete(
  "/:videoId",
  requireDashboardSession,
  repoAccess({ minRole: "maintain" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.deleteRepositoryVideo(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

// HEAD /api/v1/repositories/:repoId/videos/:videoId/download
router.head(
  "/:videoId/download",
  requireDashboardOrPython,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    await redirectToSignedDownload(res, video);
  }),
);

// GET /api/v1/repositories/:repoId/videos/:videoId/download
router.get(
  "/:videoId/download",
  requireDashboardOrPython,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    await redirectToSignedDownload(res, video);
  }),
);

export const repositoryVideosRoutes = router;
