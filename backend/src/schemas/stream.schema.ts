import { z } from "zod";

const optionalHookString = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().min(1).optional(),
);

const optionalHookNumber = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  },
  z.coerce.number().optional(),
);

export const streamRegisterSchema = z.object({
  repository_id: z.uuid(),
  device_type: z.string().max(100).optional(),
});

export const publishTicketParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export const streamConnectionHeartbeatParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
  connectionId: z.string().min(1),
});

export const streamConnectionHeartbeatBodySchema = z.object({
  generation: z.coerce.number().int().nonnegative(),
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
  source_id: optionalHookString,
  segment_path: z.string().min(1),
});

export const segmentCompleteHookSchema = z.object({
  path: z.string().min(1),
  source_id: optionalHookString,
  segment_path: z.string().min(1),
  segment_duration: optionalHookNumber,
});

export const recordingSessionIdParamsSchema = z.object({
  recordingSessionId: z.string().uuid(),
});

export const recordingStopBodySchema = z.object({
  reason: z.enum(["USER_STOP", "GLASSES_STOP"]).default("USER_STOP"),
});

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type PublishTicketParams = z.infer<typeof publishTicketParamsSchema>;
export type StreamConnectionHeartbeatParams = z.infer<typeof streamConnectionHeartbeatParamsSchema>;
export type StreamConnectionHeartbeatBody = z.infer<typeof streamConnectionHeartbeatBodySchema>;
export type StreamReadyHookInput = z.infer<typeof streamReadyHookSchema>;
export type StreamNotReadyHookInput = z.infer<typeof streamNotReadyHookSchema>;
export type SegmentCreateHookInput = z.infer<typeof segmentCreateHookSchema>;
export type SegmentCompleteHookInput = z.infer<typeof segmentCompleteHookSchema>;
export type RecordingSessionIdParams = z.infer<typeof recordingSessionIdParamsSchema>;
export type RecordingStopBody = z.infer<typeof recordingStopBodySchema>;
