import { z } from "zod";

export const streamRegisterSchema = z.object({
  repositoryId: z.uuid(),
  deviceType: z.string().max(100).optional(),
});

export const publishTicketParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export const streamReadyHookSchema = z.object({
  path: z.string().min(1),
  ticket: z.string().min(1),
});

export const streamNotReadyHookSchema = z.object({
  path: z.string().min(1),
});

export const segmentCreateHookSchema = z.object({
  path: z.string().min(1),
  segment_path: z.string().min(1),
});

export const segmentCompleteHookSchema = z.object({
  path: z.string().min(1),
  segment_path: z.string().min(1),
});

export const recordingSessionIdParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export const recordingCloseIntentSchema = z.object({
  reason: z.literal("NORMAL_DISCONNECT"),
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type PublishTicketParams = z.infer<typeof publishTicketParamsSchema>;
export type StreamReadyHookInput = z.infer<typeof streamReadyHookSchema>;
export type StreamNotReadyHookInput = z.infer<typeof streamNotReadyHookSchema>;
export type SegmentCreateHookInput = z.infer<typeof segmentCreateHookSchema>;
export type SegmentCompleteHookInput = z.infer<typeof segmentCompleteHookSchema>;
export type RecordingSessionIdParams = z.infer<typeof recordingSessionIdParamsSchema>;
export type RecordingCloseIntentInput = z.infer<typeof recordingCloseIntentSchema>;
