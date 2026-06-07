import type { z } from "zod";

import type {
  adminUserIdParamSchema,
  createAdminUserSchema,
  resetUserPasswordSchema,
} from "../../schemas/admin.schema";

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type AdminUserIdParamInput = z.infer<typeof adminUserIdParamSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
