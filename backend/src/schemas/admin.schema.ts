import { z } from "zod";

const userIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const createAdminUserSchema = z.object({
  id: userIdSchema,
  password: z.string().min(8).max(255),
  displayName: z.string().trim().min(1).max(255).optional(),
});

export const adminUserIdParamSchema = z.object({
  userId: userIdSchema,
});

export const resetUserPasswordSchema = z.object({
  newPassword: z.string().min(8).max(255),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type AdminUserIdParamInput = z.infer<typeof adminUserIdParamSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
