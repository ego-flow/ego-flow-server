import { z } from "zod";

export const pythonTokenIdParamSchema = z.object({
  tokenId: z.string().uuid(),
});

export type CreatePythonTokenInput = { name: string };
export type PythonTokenIdParamInput = z.infer<typeof pythonTokenIdParamSchema>;
