import { z } from "zod";

export const liveStreamRecordingSessionParamSchema = z.object({
  recordingSessionId: z.string().uuid(),
});
