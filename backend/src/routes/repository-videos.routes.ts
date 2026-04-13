import fs from "node:fs";
import fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import type { Request, Response } from "express";
import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
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

const resolveFileSize = async (filePath: string, sizeBytes: bigint | null, missingMessage: string) => {
  if (sizeBytes !== null) {
    return Number(sizeBytes);
  }

  try {
    const stat = await fsp.stat(filePath);
    return stat.size;
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new AppError(404, "NOT_FOUND", missingMessage);
    }

    throw error;
  }
};

const parseRange = (rangeHeader: string, fileSize: number) => {
  if (!rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.slice("bytes=".length).split("-", 2);
  if (rawStart === undefined || rawEnd === undefined) {
    return null;
  }

  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : fileSize - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return null;
  }

  if (start >= fileSize || end >= fileSize) {
    return "unsatisfiable" as const;
  }

  return { start, end };
};

const setDownloadHeaders = (
  res: Response,
  video: {
    id: string;
    sha256: string | null;
  },
  contentLength: number,
) => {
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Disposition", `attachment; filename="${video.id}.mp4"`);
  res.setHeader("Content-Length", String(contentLength));
  if (video.sha256) {
    res.setHeader("ETag", `"${video.sha256}"`);
    res.setHeader("X-Content-Sha256", video.sha256);
  }
};

router.use(requireAuth);
router.use(validate(repoVideoRepositoryParamSchema, "params"));
router.use(repoAccess({ minRole: "read" }));

router.get(
  "/",
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
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.getRepositoryVideoStatus(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

router.delete(
  "/:videoId",
  validate(repoVideoParamsSchema, "params"),
  repoAccess({ minRole: "maintain" }),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const response = await videoService.deleteRepositoryVideo(params.repoId, params.videoId);
    res.status(200).json(response);
  }),
);

router.head(
  "/:videoId/download",
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    const fileSize = await resolveFileSize(video.path, video.sizeBytes, "Video file is not available.");

    setDownloadHeaders(res, video, fileSize);
    res.status(200).end();
  }),
);

router.get(
  "/:videoId/download",
  validate(repoVideoParamsSchema, "params"),
  asyncHandler(async (req, res) => {
    const params = req.params as RepoVideoParamsInput;
    const video = await videoService.getRepositoryVideoDownload(params.repoId, params.videoId);
    const fileSize = await resolveFileSize(video.path, video.sizeBytes, "Video file is not available.");

    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : null;
    if (rangeHeader) {
      const parsedRange = parseRange(rangeHeader, fileSize);
      if (!parsedRange || parsedRange === "unsatisfiable") {
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        res.status(416).end();
        return;
      }

      const contentLength = parsedRange.end - parsedRange.start + 1;
      setDownloadHeaders(res, video, contentLength);
      res.setHeader("Content-Range", `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`);
      res.status(206);
      await pipeline(fs.createReadStream(video.path, parsedRange), res);
      return;
    }

    setDownloadHeaders(res, video, fileSize);
    res.status(200);
    await pipeline(fs.createReadStream(video.path), res);
  }),
);

router.get(
  "/:videoId/thumbnail",
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
