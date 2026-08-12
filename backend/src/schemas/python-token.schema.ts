import { z } from "zod";

export const pythonTokenIdParamSchema = z.object({
  tokenId: z.string().uuid(),
});
