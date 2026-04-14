import fs from "node:fs";
import fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import type { Request, Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { toSignedFileUrl } from "../lib/signed-file-url";
import { getTargetDirectory } from "../lib/storage";
import { requireAuth } from "../middleware/auth.middleware";
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

const router = Router({ mergeParams: true });

const getRepositoryAccess = (req: Request) => {
  if (!req.repositoryAccess) {
    throw new AppError(500, "INTERNAL_ERROR", "Repository access context is missing.");
  }

  return req.repositoryAccess;
};

const isMissingFileError = (error: unknown) =>
  error instanceof Error && "code" in error && String(error.code) === "ENOENT";

const ensureFileExists = async (filePath: string, missingMessage: string) => {
  try {
    await fsp.stat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new AppError(404, "NOT_FOUND", missingMessage);
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
    throw new AppError(404, "NOT_FOUND", "Video file is not available.");
  }

  res.redirect(307, signedUrl);
};

router.use(validate(repoVideoRepositoryParamSchema, "params"));

router.get(
  "/",
  requireAuth,
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

router.get(
  "/:videoId",
  requireAuth,
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

router.get(
  "/:videoId/status",
  requireAuth,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.getRepositoryVideoStatus(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

router.delete(
  "/:videoId",
  requireAuth,
  repoAccess({ minRole: "maintain" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.deleteRepositoryVideo(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

router.head(
  "/:videoId/download",
  requireAuth,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    await redirectToSignedDownload(res, video);
  }),
);

router.get(
  "/:videoId/download",
  requireAuth,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    await redirectToSignedDownload(res, video);
  }),
);

router.get(
  "/:videoId/thumbnail",
  requireAuth,
  repoAccess({ minRole: "read" }),
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoThumbnail(params.repoId, params.videoId);

    try {
      await fsp.stat(video.path);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new AppError(404, "NOT_FOUND", "Thumbnail is not available.");
      }

      throw error;
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200);
    await pipeline(fs.createReadStream(video.path), res);
  }),
);

export const repositoryVideosRoutes = router;
