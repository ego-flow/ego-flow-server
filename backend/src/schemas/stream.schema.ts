import { z } from "zod";

export const streamRegisterSchema = z.object({
  repository_id: z.uuid(),
  device_type: z.string().max(100).optional(),
});

export const recordingCompleteSchema = z.object({
  path: z.string().min(1),
  recording_path: z.string().min(1),
});

export const streamStopParamsSchema = z.object({
  repositoryId: z.uuid(),
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type RecordingCompleteInput = z.infer<typeof recordingCompleteSchema>;
export type StreamStopParams = z.infer<typeof streamStopParamsSchema>;
