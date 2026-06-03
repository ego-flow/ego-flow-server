import { z } from "zod";

const userIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const apiTokenIdParamSchema = z.object({
  tokenId: z.string().uuid(),
});

export const adminApiTokenListQuerySchema = z.object({
  user_id: userIdSchema.optional(),
});

export type CreateApiTokenInput = { name: string };
export type ApiTokenIdParamInput = z.infer<typeof apiTokenIdParamSchema>;
export type AdminApiTokenListQueryInput = z.infer<typeof adminApiTokenListQuerySchema>;
