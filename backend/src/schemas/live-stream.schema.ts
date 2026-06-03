import { z } from "zod";

export const liveStreamRecordingSessionParamSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export type LiveStreamRecordingSessionParamInput = z.infer<typeof liveStreamRecordingSessionParamSchema>;
