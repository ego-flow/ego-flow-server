import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validate } from "../middleware/validate.middleware";
import type { AdminUserIdParamInput } from "../schemas/admin.schema";
import { adminUserIdParamSchema, createAdminUserSchema, resetUserPasswordSchema } from "../schemas/admin.schema";
import { adminService } from "../services/admin.service";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.post(
  "/users",
  validate(createAdminUserSchema),
  asyncHandler(async (req, res) => {
    const response = await adminService.createUser(req.body);
    res.status(201).json(response);
  }),
);

router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const response = await adminService.listUsers();
    res.status(200).json(response);
  }),
);

router.delete(
  "/users/:userId",
  validate(adminUserIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const response = await adminService.deactivateUser((req.params as AdminUserIdParamInput).userId);
    res.status(200).json(response);
  }),
);

router.put(
  "/users/:userId/reset-password",
  validate(adminUserIdParamSchema, "params"),
  validate(resetUserPasswordSchema),
  asyncHandler(async (req, res) => {
    const response = await adminService.resetUserPassword((req.params as AdminUserIdParamInput).userId, req.body);
    res.status(200).json(response);
  }),
);

router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const response = await adminService.getSettings();
    res.status(200).json(response);
  }),
);

export const adminRoutes = router;
