import { z } from "zod";

const videoKeySchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const streamRegisterSchema = z.object({
  video_key: videoKeySchema,
  device_type: z.string().max(100).optional(),
});

export const recordingCompleteSchema = z.object({
  path: z.string().min(1),
  recording_path: z.string().min(1),
});

export const streamStopParamsSchema = z.object({
  videoKey: videoKeySchema,
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type RecordingCompleteInput = z.infer<typeof recordingCompleteSchema>;
export type StreamStopParams = z.infer<typeof streamStopParamsSchema>;
