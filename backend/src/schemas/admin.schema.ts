import { z } from "zod";

const userIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const createAdminUserSchema = z.object({
  id: userIdSchema,
  password: z.string(),
  displayName: z.string().trim().max(255).optional(),
});

export const adminUserIdParamSchema = z.object({
  userId: userIdSchema,
});

export const resetUserPasswordSchema = z.object({
  newPassword: z.string(),
});
