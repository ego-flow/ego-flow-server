import { Router, type Request } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { repoAccess } from "../middleware/repo-access.middleware";
import {
  requireDashboardOrApp,
  requireDashboardOrAppOrPython,
  requireDashboardSession,
  requirePythonToken,
} from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type {
  ManifestQueryInput,
  RepositoryIdParamInput,
  RepositoryMemberParamInput,
  RepositoryResolveQueryInput,
} from "../schemas/repository.schema";
import {
  createRepositoryMemberSchema,
  createRepositorySchema,
  manifestQuerySchema,
  repositoryIdParamSchema,
  repositoryMemberParamSchema,
  repositoryResolveQuerySchema,
  updateRepositoryMemberSchema,
  updateRepositorySchema,
} from "../schemas/repository.schema";
import { repositoryService } from "../services/repository.service";
import { videoService } from "../services/video.service";

const router = Router();

const getAuthenticatedUser = (req: Request) => req.user!;

const getRepositoryAccess = (req: Request) => {
  if (!req.repositoryAccess) {
    throw new AppError(500, "INTERNAL_ERROR", "Repository access context is missing.");
  }

  return req.repositoryAccess;
};

router.post(
  "/",
  requireDashboardSession,
  validate(createRepositorySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.createRepository(user.userId, req.body);
    res.status(201).json(response);
  }),
);

router.get(
  "/mine",
  requireDashboardOrApp,
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.listMaintainedRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

router.get(
  "/",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.listAccessibleRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

router.get(
  "/resolve",
  requireDashboardOrAppOrPython,
  validate(repositoryResolveQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const query = req.query as unknown as RepositoryResolveQueryInput;
    let ownerId: string;
    let repoName: string;

    if (query.slug) {
      const parts = query.slug.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new AppError(400, "INVALID_SLUG", "Slug must be in 'owner/name' format.");
      }

      [ownerId, repoName] = parts;
    } else {
      ownerId = query.owner_id!;
      repoName = query.name!;
    }

    const response = await repositoryService.resolveRepository(
      user.userId,
      user.role,
      ownerId,
      repoName,
    );
    res.status(200).json(response);
  }),
);

router.get(
  "/:repoId/manifest",
  requirePythonToken,
  validate(repositoryIdParamSchema, "params"),
  validate(manifestQuerySchema, "query"),
  repoAccess({ minRole: "read" }),
  asyncHandler(async (req, res) => {
    const { repoId } = req.params as RepositoryIdParamInput;
    const query = req.query as unknown as ManifestQueryInput;
    const { repository, effectiveRole } = getRepositoryAccess(req);

    const response = await videoService.getRepositoryManifest(repoId, repository, effectiveRole, query);
    res.status(200).json(response);
  }),
);

router.get(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "read" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.getRepositoryDetail(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.patch(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(updateRepositorySchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.updateRepository(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.delete(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.deleteRepository(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.get(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.listRepositoryMembers(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.post(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(createRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const response = await repositoryService.addRepositoryMember(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.patch(
  "/:repoId/members/:userId",
  requireDashboardSession,
  validate(repositoryMemberParamSchema, "params"),
  validate(updateRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoryService.updateRepositoryMember(
      user.userId,
      user.role,
      params.repoId,
      params.userId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.delete(
  "/:repoId/members/:userId",
  requireDashboardSession,
  validate(repositoryMemberParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthenticatedUser(req);
    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoryService.deleteRepositoryMember(
      user.userId,
      user.role,
      params.repoId,
      params.userId,
    );
    res.status(200).json(response);
  }),
);

export const repositoriesRoutes = router;
