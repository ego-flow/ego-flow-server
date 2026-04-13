import { z } from "zod";

const userIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const apiTokenIdParamSchema = z.object({
  tokenId: z.string().uuid(),
});

export const adminApiTokenListQuerySchema = z.object({
  user_id: userIdSchema.optional(),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
export type ApiTokenIdParamInput = z.infer<typeof apiTokenIdParamSchema>;
export type AdminApiTokenListQueryInput = z.infer<typeof adminApiTokenListQuerySchema>;
