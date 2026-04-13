import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { repoAccess } from "../middleware/repo-access.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type {
  RepositoryIdParamInput,
  RepositoryMemberParamInput,
  RepositoryResolveQueryInput,
} from "../schemas/repository.schema";
import {
  createRepositoryMemberSchema,
  createRepositorySchema,
  repositoryIdParamSchema,
  repositoryMemberParamSchema,
  repositoryResolveQuerySchema,
  updateRepositoryMemberSchema,
  updateRepositorySchema,
} from "../schemas/repository.schema";
import { repositoryService } from "../services/repository.service";

const router = Router();

router.use(requireAuth);

router.post(
  "/",
  validate(createRepositorySchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.createRepository(req.user.userId, req.body);
    res.status(201).json(response);
  }),
);

router.get(
  "/mine",
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.listMaintainedRepositories(req.user.userId, req.user.role);
    res.status(200).json(response);
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.listAccessibleRepositories(req.user.userId, req.user.role);
    res.status(200).json(response);
  }),
);

router.get(
  "/resolve",
  validate(repositoryResolveQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

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
      req.user.userId,
      req.user.role,
      ownerId,
      repoName,
    );
    res.status(200).json(response);
  }),
);

router.get(
  "/:repoId",
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "read" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.getRepositoryDetail(
      req.user.userId,
      req.user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.patch(
  "/:repoId",
  validate(repositoryIdParamSchema, "params"),
  validate(updateRepositorySchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.updateRepository(
      req.user.userId,
      req.user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.delete(
  "/:repoId",
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.deleteRepository(
      req.user.userId,
      req.user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.get(
  "/:repoId/members",
  validate(repositoryIdParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.listRepositoryMembers(
      req.user.userId,
      req.user.role,
      (req.params as RepositoryIdParamInput).repoId,
    );
    res.status(200).json(response);
  }),
);

router.post(
  "/:repoId/members",
  validate(repositoryIdParamSchema, "params"),
  validate(createRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await repositoryService.addRepositoryMember(
      req.user.userId,
      req.user.role,
      (req.params as RepositoryIdParamInput).repoId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.patch(
  "/:repoId/members/:userId",
  validate(repositoryMemberParamSchema, "params"),
  validate(updateRepositoryMemberSchema),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoryService.updateRepositoryMember(
      req.user.userId,
      req.user.role,
      params.repoId,
      params.userId,
      req.body,
    );
    res.status(200).json(response);
  }),
);

router.delete(
  "/:repoId/members/:userId",
  validate(repositoryMemberParamSchema, "params"),
  repoAccess({ minRole: "admin" }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const params = req.params as RepositoryMemberParamInput;
    const response = await repositoryService.deleteRepositoryMember(
      req.user.userId,
      req.user.role,
      params.repoId,
      params.userId,
    );
    res.status(200).json(response);
  }),
);

export const repositoriesRoutes = router;
