import { z } from "zod";

export const apiTokenIdParamSchema = z.object({
  tokenId: z.string().uuid(),
});

export type CreateApiTokenInput = { name: string };
export type ApiTokenIdParamInput = z.infer<typeof apiTokenIdParamSchema>;
