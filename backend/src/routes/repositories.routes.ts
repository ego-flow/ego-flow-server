import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { BadRequest, ErrorCode } from "../lib/errors";
import { getAuthUser, getRepositoryAccess } from "../lib/request-context";
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

// POST /api/v1/repositories
router.post(
  "/",
  requireDashboardSession,
  validate(createRepositorySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.createRepository(user.userId, req.body);
    res.status(201).json(response);
  }),
);

// GET /api/v1/repositories/maintain
router.get(
  "/maintain",
  requireDashboardOrApp,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.listMaintainedRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/deactivated
router.get(
  "/deactivated",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.listDeactivatedAdminRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories
router.get(
  "/",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.listAccessibleRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/resolve
router.get(
  "/resolve",
  requireDashboardOrAppOrPython,
  validate(repositoryResolveQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const query = req.query as unknown as RepositoryResolveQueryInput;
    let ownerId: string;
    let repoName: string;

    if (query.slug) {
      const parts = query.slug.split("/");
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw BadRequest("Slug must be in 'owner/name' format.", ErrorCode.INVALID_SLUG);
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

// DELETE /api/v1/repositories/:repoId/deactivate
router.delete(
  "/:repoId/deactivate",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.deactivateRepository(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/delete-readiness
router.get(
  "/:repoId/delete-readiness",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.getRepositoryDeleteReadiness(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/manifest
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

// GET /api/v1/repositories/:repoId
router.get(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "read" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.getRepositoryDetail(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

// PATCH /api/v1/repositories/:repoId
router.patch(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(updateRepositorySchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.updateRepository(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/repositories/:repoId
router.delete(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.permanentlyDeleteRepository(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/members
router.get(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.listRepositoryMembers(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

// POST /api/v1/repositories/:repoId/members
router.post(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(createRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoryService.addRepositoryMember(
      user.userId,
      user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

// PATCH /api/v1/repositories/:repoId/members/:userId
router.patch(
  "/:repoId/members/:userId",
  requireDashboardSession,
  validate(repositoryMemberParamSchema, "params"),
  validate(updateRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
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

// DELETE /api/v1/repositories/:repoId/members/:userId
router.delete(
  "/:repoId/members/:userId",
  requireDashboardSession,
  validate(repositoryMemberParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
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
