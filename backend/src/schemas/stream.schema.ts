import { z } from "zod";

export const streamRegisterSchema = z.object({
  repository_id: z.uuid(),
  device_type: z.string().max(100).optional(),
});

export const streamReadyHookSchema = z.object({
  path: z.string().min(1),
  query: z.string().optional(),
  source_id: z.string().min(1),
  source_type: z.string().min(1),
});

export const streamNotReadyHookSchema = z.object({
  path: z.string().min(1),
  source_id: z.string().min(1),
  source_type: z.string().min(1),
});

export const segmentCreateHookSchema = z.object({
  path: z.string().min(1),
  segment_path: z.string().min(1),
});

export const segmentCompleteHookSchema = z.object({
  path: z.string().min(1),
  segment_path: z.string().min(1),
  segment_duration: z.coerce.number().optional(),
});

export const recordingSessionIdParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export const recordingStopBodySchema = z.object({
  reason: z.enum(["USER_STOP", "GLASSES_STOP"]).default("USER_STOP"),
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type StreamReadyHookInput = z.infer<typeof streamReadyHookSchema>;
export type StreamNotReadyHookInput = z.infer<typeof streamNotReadyHookSchema>;
export type SegmentCreateHookInput = z.infer<typeof segmentCreateHookSchema>;
export type SegmentCompleteHookInput = z.infer<typeof segmentCompleteHookSchema>;
export type RecordingSessionIdParams = z.infer<typeof recordingSessionIdParamsSchema>;
export type RecordingStopBody = z.infer<typeof recordingStopBodySchema>;
