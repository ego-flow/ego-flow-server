import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { requireDashboardSession } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validate } from "../middleware/validate.middleware";
import type { AdminApiTokenListQueryInput } from "../schemas/api-token.schema";
import { adminApiTokenListQuerySchema } from "../schemas/api-token.schema";
import type { AdminUserIdParamInput } from "../schemas/admin.schema";
import { adminUserIdParamSchema, createAdminUserSchema, resetUserPasswordSchema } from "../schemas/admin.schema";
import { apiTokenService } from "../services/api-token.service";
import { adminService } from "../services/admin.service";

const router = Router();

router.use(requireDashboardSession, requireRole("admin"));

// POST /api/v1/admin/users
router.post(
  "/users",
  validate(createAdminUserSchema),
  asyncHandler(async (req, res) => {
    const response = await adminService.createUser(req.body);
    res.status(201).json(response);
  }),
);

// GET /api/v1/admin/users
router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const response = await adminService.listUsers();
    res.status(200).json(response);
  }),
);

// GET /api/v1/admin/python/tokens
router.get(
  "/python/tokens",
  validate(adminApiTokenListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as AdminApiTokenListQueryInput;
    const tokens = await apiTokenService.listActiveTokensForAdmin(
      query.user_id
        ? {
            userId: query.user_id,
          }
        : undefined,
    );
    res.status(200).json({ tokens });
  }),
);

// DELETE /api/v1/admin/users/:userId/deactivate
router.delete(
  "/users/:userId/deactivate",
  validate(adminUserIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const response = await adminService.deactivateUser((req.params as AdminUserIdParamInput).userId);
    res.status(200).json(response);
  }),
);

// GET /api/v1/admin/users/:userId/delete-readiness
router.get(
  "/users/:userId/delete-readiness",
  validate(adminUserIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const response = await adminService.getUserDeleteReadiness((req.params as AdminUserIdParamInput).userId);
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/admin/users/:userId
router.delete(
  "/users/:userId",
  validate(adminUserIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const response = await adminService.permanentlyDeleteUser((req.params as AdminUserIdParamInput).userId);
    res.status(200).json(response);
  }),
);

// PUT /api/v1/admin/dashboard/users/:userId/password
router.put(
  "/dashboard/users/:userId/password",
  validate(adminUserIdParamSchema, "params"),
  validate(resetUserPasswordSchema),
  asyncHandler(async (req, res) => {
    const response = await adminService.resetUserPassword((req.params as AdminUserIdParamInput).userId, req.body);
    res.status(200).json(response);
  }),
);

// GET /api/v1/admin/settings
router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const response = await adminService.getSettings();
    res.status(200).json(response);
  }),
);

export const adminRoutes = router;
