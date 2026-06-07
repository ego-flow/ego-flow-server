import { z } from "zod";

export const recordingSessionIngestTypeSchema = z.enum(["MEDIAMTX", "HTTP"]);

export const streamRegisterSchema = z.object({
  repositoryId: z.uuid(),
  deviceType: z.string().max(100).optional(),
  ingestType: recordingSessionIngestTypeSchema,
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

export const httpStreamStartSchema = z.object({
  publish_ticket: z.string().min(1),
});

export const httpStreamFinishSchema = z.object({
  total_bytes: z.number().int().nonnegative().safe(),
});

export const httpStreamChunkHeadersSchema = z.object({
  "x-chunk-sequence": z.coerce.number().int().nonnegative().safe(),
  "x-chunk-offset": z.coerce.number().int().nonnegative().safe(),
});
