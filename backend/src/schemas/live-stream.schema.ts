import { z } from "zod";

export const liveStreamIdParamSchema = z.object({
  streamId: z.string().uuid(),
});

export type LiveStreamIdParamInput = z.infer<typeof liveStreamIdParamSchema>;
