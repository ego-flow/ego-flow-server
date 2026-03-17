import { z } from "zod";

export const streamRegisterSchema = z.object({
  video_key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  device_type: z.string().max(100).optional(),
});

export const recordingCompleteSchema = z.object({
  path: z.string().min(1),
  recording_path: z.string().min(1),
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type RecordingCompleteInput = z.infer<typeof recordingCompleteSchema>;
