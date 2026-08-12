import { Router } from "express";

import { asyncHandler } from "../lib/http/async-handler";
import { getAuthUser, getRepositoryAccessContext } from "../lib/http/request-context";
import { repoAccess, repoStatus } from "../middleware/repository.middleware";
import {
  requireDashboardOrApp,
  requireDashboardOrAppOrPython,
  requireDashboardSession,
  requirePythonToken,
} from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type {
  ManifestQueryInput,
  RepositoryMemberParamInput,
  RepositoryResolveQueryInput,
} from "../types/repository/request";
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
import { repositoriesService } from "../services/repositories.service";

const router = Router();

// POST /api/v1/repositories
router.post(
  "/",
  requireDashboardSession,
  validate(createRepositorySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoriesService.createRepository(user.userId, req.body);
    res.status(201).json(response);
  }),
);

// GET /api/v1/repositories/maintain
router.get(
  "/maintain",
  requireDashboardOrApp,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoriesService.listMaintainedRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/deactivated
router.get(
  "/deactivated",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoriesService.listDeactivatedAdminRepositories(user.userId, user.role);
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories
router.get(
  "/",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await repositoriesService.listAccessibleRepositories(user.userId, user.role);
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
    const response = await repositoriesService.resolveRepositoryFromQuery(
      user.userId,
      user.role,
      query,
    );
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/repositories/:repoId/deactivate
router.delete(
  "/:repoId/deactivate",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ action: "repository.deactivate" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.deactivateRepository(getRepositoryAccessContext(req));
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/delete-readiness
router.get(
  "/:repoId/delete-readiness",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ action: "repository.delete" }),
  repoStatus({ required: "deactivated" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.getRepositoryDeleteReadiness(getRepositoryAccessContext(req));
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/manifest
router.get(
  "/:repoId/manifest",
  requirePythonToken,
  validate(repositoryIdParamSchema, "params"),
  validate(manifestQuerySchema, "query"),
  repoAccess({ action: "video.manifest" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.getRepositoryManifest(
      getRepositoryAccessContext(req),
      req.query as unknown as ManifestQueryInput,
    );
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId
router.get(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ action: "repository.read" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.getRepositoryDetail(getRepositoryAccessContext(req));
    res.status(200).json(response);
  }),
);

// PATCH /api/v1/repositories/:repoId
router.patch(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(updateRepositorySchema),
  repoAccess({ action: "repository.updateSettings" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.updateRepository(getRepositoryAccessContext(req), req.body);
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/repositories/:repoId
router.delete(
  "/:repoId",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ action: "repository.delete" }),
  repoStatus({ required: "deactivated" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.permanentlyDeleteRepository(getRepositoryAccessContext(req));
    res.status(200).json(response);
  }),
);

// GET /api/v1/repositories/:repoId/members
router.get(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ action: "repository.members.list" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.listRepositoryMembers(getRepositoryAccessContext(req));
    res.status(200).json(response);
  }),
);

// POST /api/v1/repositories/:repoId/members
router.post(
  "/:repoId/members",
  requireDashboardSession,
  validate(repositoryIdParamSchema, "params"),
  validate(createRepositoryMemberSchema),
  repoAccess({ action: "repository.members.add" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const response = await repositoriesService.addRepositoryMember(getRepositoryAccessContext(req), req.body);
    res.status(200).json(response);
  }),
);

// PATCH /api/v1/repositories/:repoId/members/:userId
router.patch(
  "/:repoId/members/:userId",
  requireDashboardSession,
  validate(repositoryMemberParamSchema, "params"),
  validate(updateRepositoryMemberSchema),
  repoAccess({ action: "repository.members.update" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoriesService.updateRepositoryMember(
      getRepositoryAccessContext(req),
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
  repoAccess({ action: "repository.members.delete" }),
  repoStatus({ required: "active" }),
  asyncHandler(async (req, res) => {
    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoriesService.deleteRepositoryMember(
      getRepositoryAccessContext(req),
      params.userId,
    );
    res.status(200).json(response);
  }),
);

export const repositoriesRoutes = router;
